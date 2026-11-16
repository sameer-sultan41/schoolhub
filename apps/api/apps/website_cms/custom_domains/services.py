"""Custom domains: claim, verify, primary, delete and the beat's re-checks (module doc §7.2).

Rules this file owns:

- DNS never runs inside a transaction (ADR-0034). A check reads the claim in one short
  transaction, calls the verifier with nothing open, then writes in another. Every write is a
  conditional `UPDATE ... WHERE status IN (<expected>) AND deleted_at IS NULL`; zero rows means
  the user changed or deleted the domain mid-check, and the result is discarded (L49).
- `custom_domain_routes` has no RLS, so every route write names the domain's own tenant and
  every delete filters by both `custom_domain_id` and `tenant_id`. Activation inserts the route
  and relies on its unique `domain`: an `IntegrityError` means another school holds the domain
  (never check-then-write).
- Only an `active` domain may be primary (a DB CHECK), so every write moving a domain off
  `active` clears `is_primary` in the same `UPDATE`.
- Every domain write in a school takes the tenant's `CUSTOM_DOMAINS` advisory lock, so the
  limit, the primary flag and activation serialise.
"""

from __future__ import annotations

import enum
import secrets
from datetime import timedelta
from typing import Any
from uuid import UUID

import idna
from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import QuerySet
from django.shortcuts import get_object_or_404
from django.utils import timezone

from apps.website_cms.constants import (
    ACTIVE_RECHECK_FAILURE_LIMIT,
    DOMAIN_ERROR_MAX_LENGTH,
    DOMAIN_FAILURE_NOTIFY_AFTER_HOURS,
    DOMAIN_RETRY_WINDOW_HOURS,
    MAX_CUSTOM_DOMAINS,
    VERIFY_IN_FLIGHT_SECONDS,
)
from apps.website_cms.content import locked, touch
from apps.website_cms.custom_domains.adapters import (
    DnsCheck,
    get_dns_verifier,
    get_edge_provisioner,
)
from apps.website_cms.errors import violation
from apps.website_cms.models import CustomDomain, CustomDomainRoute, CustomDomainStatus
from apps.website_cms.notifications import (
    DOMAIN_ACTIVE,
    DOMAIN_FAILED,
    DOMAIN_RECIPIENT_ROLES,
    role_recipients,
)
from apps.website_cms.revalidation import host_tag, host_tags, queue_revalidation
from core.api.exceptions import Conflict, DomainRuleViolation
from core.notifications.services import notify
from core.tenancy.context import tenant_atomic
from core.tenancy.hosts import normalise_host
from core.tenancy.locks import AdvisoryLockNamespace, advisory_xact_lock
from core.tenancy.models import Tenant

#: The statuses a DNS check may move a claim out of.
VERIFIABLE = (
    CustomDomainStatus.PENDING_DNS,
    CustomDomainStatus.VERIFYING,
    CustomDomainStatus.FAILED,
)
#: Characters that make the input a URL or an address, not a domain name.
_NOT_A_DOMAIN = frozenset(":/\\@?#% \t\n")
DOMAIN_TAKEN_REASON = "Another school's website already uses this domain."
NOTIFICATION_SOURCE = "custom_domain"
# A notification title and email subject hold 200 characters; the longest domain subject
# ("<hostname> could not be verified") adds 22 to the hostname.
_TITLE_MAX = 200
_LONGEST_TITLE_SUFFIX = len(" could not be verified")


class Outcome(enum.StrEnum):
    ACTIVATED = "activated"
    FAILED = "failed"
    TAKEN = "taken"
    DISCARDED = "discarded"


def normalise_domain(raw: str) -> str:
    """The domain's lowercase ASCII (A-label) form, or a 422.

    UTS #46 (IDNA 2008, non-transitional) maps a Unicode name the way browsers do, so the
    stored name is the one the renderer receives in `Host`; `normalise_host` then applies the
    LDH and 253-character rules host resolution uses. At least two labels, the last not
    numeric (an IP address is not a domain), and never the platform's own domain.
    """
    value = raw.strip()
    if not value or any(char in _NOT_A_DOMAIN for char in value):
        raise _invalid_domain()
    try:
        ascii_name = idna.encode(value, uts46=True).decode("ascii")
    except UnicodeError:  # idna.IDNAError subclasses it
        raise _invalid_domain() from None
    name = normalise_host(ascii_name)
    labels = name.split(".") if name else []
    if name is None or len(labels) < 2 or labels[-1].isdigit():
        raise _invalid_domain()
    platform = settings.PLATFORM_DOMAIN.lower()
    if name == platform or name.endswith(f".{platform}"):
        raise violation(
            "domain", "platform_domain", "use your own domain, not one under the platform's."
        )
    return name


def _invalid_domain() -> DomainRuleViolation:
    return violation("domain", "invalid_domain", "enter a domain name such as www.example.org.")


def create_custom_domain(tenant: Tenant, raw_domain: str, actor_id: UUID) -> CustomDomain:
    """Claim a domain (`pending_dns`) with a fresh verification token. Runs in a tenant txn."""
    domain = normalise_domain(raw_domain)
    advisory_xact_lock(AdvisoryLockNamespace.CUSTOM_DOMAINS, tenant.pk)
    if CustomDomain.objects.alive().count() >= MAX_CUSTOM_DOMAINS:
        raise violation(
            "domain", "domain_limit", f"a school can add at most {MAX_CUSTOM_DOMAINS} domains."
        )
    try:
        with transaction.atomic():
            return CustomDomain.objects.create(
                tenant=tenant,
                domain=domain,
                verification_token=secrets.token_urlsafe(32),
                created_by=actor_id,
                updated_by=actor_id,
            )
    except IntegrityError:
        raise violation(
            "domain", "duplicate_domain", "this school has already added this domain."
        ) from None


def set_primary(tenant: Tenant, pk: UUID, is_primary: bool, actor_id: UUID) -> CustomDomain:
    """Make an active domain the site's primary host (clearing any other), or unset it."""
    advisory_xact_lock(AdvisoryLockNamespace.CUSTOM_DOMAINS, tenant.pk)
    row = locked(CustomDomain, pk)
    if row.is_primary == is_primary:
        return row
    if is_primary:
        if row.status != CustomDomainStatus.ACTIVE:
            raise violation(
                "is_primary", "not_active", "only an active domain can be the primary domain."
            )
        CustomDomain.objects.alive().filter(is_primary=True).exclude(pk=pk).update(
            is_primary=False, updated_by=actor_id, updated_at=timezone.now()
        )
    touch(row, actor_id, is_primary=is_primary)
    queue_revalidation(tenant.pk, host_tags(tenant))
    return row


def delete_custom_domain(tenant: Tenant, pk: UUID, actor_id: UUID) -> CustomDomain:
    """Soft-delete the claim and drop its own route; the site falls back to the subdomain.

    The route delete names this claim and this tenant, so deleting a pending claim never
    touches another school's active route for the same name (Review Focus 2).
    """
    advisory_xact_lock(AdvisoryLockNamespace.CUSTOM_DOMAINS, tenant.pk)
    row = locked(CustomDomain, pk)
    was_active = row.status == CustomDomainStatus.ACTIVE
    _drop_route(tenant, row)
    touch(row, actor_id, deleted_at=timezone.now(), is_primary=False)
    if was_active:
        _revalidate(tenant, row.domain)
    return row


def verify_custom_domain(tenant: Tenant, pk: UUID, actor_id: UUID | None) -> CustomDomain:
    """`:verify`. Must run with no transaction open: DNS sits between two short transactions.

    An active domain is returned as it is. A failed check stores `failed` and the reason; a
    domain another school holds stores `failed` and answers 409 `domain_taken`.
    """
    with tenant_atomic(tenant.pk):
        row = get_object_or_404(CustomDomain.objects.alive(), pk=pk)
        if row.status == CustomDomainStatus.ACTIVE:
            return row
        if row.status not in VERIFIABLE:
            raise violation("status", "not_verifiable", "this domain cannot be verified.")
        _claim(row, VERIFIABLE).update(
            status=CustomDomainStatus.VERIFYING, updated_by=actor_id, updated_at=timezone.now()
        )
    check = _check(row)
    outcome = _apply_check(tenant, row, (CustomDomainStatus.VERIFYING,), check, actor_id)
    if outcome is Outcome.TAKEN:
        raise Conflict({"domain": f"domain_taken: {DOMAIN_TAKEN_REASON}"})
    with tenant_atomic(tenant.pk):
        return get_object_or_404(CustomDomain.objects.alive(), pk=pk)


def reverify_tenant_domains(tenant_id: UUID) -> int:
    """Beat step (no transaction open): re-check this school's claims added in the last 72 h.

    A `pending_dns` claim keeps its status on a failed check (its owner may still be setting
    DNS up) but records the reason; `verifying` and `failed` claims become `failed`. A claim
    moved to `verifying` in the last `VERIFY_IN_FLIGHT_SECONDS` is skipped: a user's `:verify`
    is checking it.
    """
    tenant = Tenant.objects.get(pk=tenant_id)
    now = timezone.now()
    since = now - timedelta(hours=DOMAIN_RETRY_WINDOW_HOURS)
    in_flight = now - timedelta(seconds=VERIFY_IN_FLIGHT_SECONDS)
    with tenant_atomic(tenant_id):
        rows = list(
            CustomDomain.objects.alive()
            .filter(status__in=VERIFIABLE, created_at__gt=since)
            # A user's own `:verify` is mid-check: let it write its result, not this sweep.
            .exclude(status=CustomDomainStatus.VERIFYING, updated_at__gt=in_flight)
        )
    acted = 0
    for row in rows:
        outcome = _apply_check(
            tenant,
            row,
            (row.status,),
            _check(row),
            None,
            keep_status=row.status == CustomDomainStatus.PENDING_DNS,
        )
        acted += outcome is not Outcome.DISCARDED
    return acted


def recheck_tenant_active_domains(tenant_id: UUID) -> int:
    """Daily beat step (no transaction open): re-verify this school's active domains.

    Only the CNAME is checked: it is what still routes the domain to us. The TXT token proved
    ownership at verification, and schools often remove it after go-live. After
    `ACTIVE_RECHECK_FAILURE_LIMIT` consecutive failures the domain turns `failed`, its route
    is dropped and the school is notified: lapsed verification falls back to the subdomain
    (website-builder §1).
    """
    tenant = Tenant.objects.get(pk=tenant_id)
    with tenant_atomic(tenant_id):
        rows = list(CustomDomain.objects.alive().filter(status=CustomDomainStatus.ACTIVE))
    verifier = get_dns_verifier()
    target = settings.WEBSITE_CNAME_TARGET
    acted = 0
    for row in rows:
        acted += _apply_recheck(tenant, row, verifier.check_cname(row.domain, target))
    return acted


def _check(row: CustomDomain) -> DnsCheck:
    return get_dns_verifier().check(
        row.domain, row.verification_token, settings.WEBSITE_CNAME_TARGET
    )


def _claim(row: CustomDomain, expected: tuple[str, ...]) -> QuerySet[CustomDomain]:
    """The row, only while it is live and still in an expected status (the L49 guard)."""
    return CustomDomain.objects.alive().filter(pk=row.pk, status__in=expected)


def _apply_check(
    tenant: Tenant,
    row: CustomDomain,
    expected: tuple[str, ...],
    check: DnsCheck,
    actor_id: UUID | None,
    *,
    keep_status: bool = False,
) -> Outcome:
    """Write a check's result in its own transaction; provision TLS after it commits."""
    with tenant_atomic(tenant.pk):
        advisory_xact_lock(AdvisoryLockNamespace.CUSTOM_DOMAINS, tenant.pk)
        if check.ok:
            outcome = _activate(tenant, row, expected, actor_id)
        else:
            outcome = _fail(tenant, row, expected, check.reason, actor_id, keep_status=keep_status)
    if outcome is Outcome.ACTIVATED:
        get_edge_provisioner().request(row.domain)
    return outcome


def _activate(
    tenant: Tenant, row: CustomDomain, expected: tuple[str, ...], actor_id: UUID | None
) -> Outcome:
    now = timezone.now()
    try:
        # One savepoint: a taken domain rolls the activation back with the route insert, so
        # `_fail` sees the original status and the claim keeps `failure_notified_at`.
        with transaction.atomic():
            moved = _claim(row, expected).update(
                status=CustomDomainStatus.ACTIVE,
                verified_at=now,
                last_error="",
                consecutive_failures=0,
                failure_notified_at=None,
                updated_by=actor_id,
                updated_at=now,
            )
            if not moved:
                return Outcome.DISCARDED
            CustomDomainRoute.objects.create(
                domain=row.domain, tenant_id=tenant.pk, custom_domain_id=row.pk
            )
    except IntegrityError:
        _fail(tenant, row, expected, DOMAIN_TAKEN_REASON, actor_id)
        return Outcome.TAKEN
    _notify(DOMAIN_ACTIVE, tenant, row)
    _revalidate(tenant, row.domain)
    return Outcome.ACTIVATED


def _fail(
    tenant: Tenant,
    row: CustomDomain,
    expected: tuple[str, ...],
    reason: str,
    actor_id: UUID | None,
    *,
    keep_status: bool = False,
) -> Outcome:
    now = timezone.now()
    fields: dict[str, Any] = {
        "last_error": reason[:DOMAIN_ERROR_MAX_LENGTH],
        "updated_by": actor_id,
        "updated_at": now,
    }
    if not keep_status:
        fields |= {"status": CustomDomainStatus.FAILED, "is_primary": False}
    if not _claim(row, expected).update(**fields):
        return Outcome.DISCARDED
    # Once per claim, and only after it has been failing for a day (§12).
    if row.created_at <= now - timedelta(hours=DOMAIN_FAILURE_NOTIFY_AFTER_HOURS):
        first = CustomDomain.objects.filter(pk=row.pk, failure_notified_at__isnull=True)
        if first.update(failure_notified_at=now):
            _notify(DOMAIN_FAILED, tenant, row, reason=reason)
    return Outcome.FAILED


def _apply_recheck(tenant: Tenant, row: CustomDomain, check: DnsCheck) -> int:
    """One active domain's daily result; 1 when a row changed."""
    now = timezone.now()
    with tenant_atomic(tenant.pk):
        advisory_xact_lock(AdvisoryLockNamespace.CUSTOM_DOMAINS, tenant.pk)
        # Matching the count read guards against two sweeps counting one failure twice.
        claim = _claim(row, (CustomDomainStatus.ACTIVE,)).filter(
            consecutive_failures=row.consecutive_failures
        )
        if check.ok:
            if row.consecutive_failures == 0:
                return 0
            return claim.update(consecutive_failures=0, last_error="", updated_at=now)
        failures = row.consecutive_failures + 1
        reason = check.reason[:DOMAIN_ERROR_MAX_LENGTH]
        if failures < ACTIVE_RECHECK_FAILURE_LIMIT:
            return claim.update(consecutive_failures=failures, last_error=reason, updated_at=now)
        lapsed = claim.update(
            status=CustomDomainStatus.FAILED,
            is_primary=False,
            consecutive_failures=failures,
            last_error=reason,
            failure_notified_at=now,
            updated_at=now,
        )
        if not lapsed:
            return 0
        _drop_route(tenant, row)
        _notify(DOMAIN_FAILED, tenant, row, reason=reason)
        _revalidate(tenant, row.domain)
        return 1


def _drop_route(tenant: Tenant, row: CustomDomain) -> None:
    CustomDomainRoute.objects.filter(custom_domain_id=row.pk, tenant_id=tenant.pk).delete()


def _revalidate(tenant: Tenant, domain: str) -> None:
    """Every host of the tenant plus the affected domain, which may no longer be one."""
    queue_revalidation(tenant.pk, [*host_tags(tenant), host_tag(domain)])


def _notify(event_key: str, tenant: Tenant, row: CustomDomain, *, reason: str = "") -> None:
    """Tell the school's IT admins (§12); a school with none is a silent no-op."""
    recipients = role_recipients(tenant.pk, DOMAIN_RECIPIENT_ROLES)
    if not recipients:
        return
    hostname = _shortened(row.domain, _TITLE_MAX - _LONGEST_TITLE_SUFFIX)
    context: dict[str, object] = {"domain.hostname": hostname, "school.name": tenant.name}
    if event_key == DOMAIN_FAILED:
        context["domain.reason"] = reason
    notify(
        event_key,
        tenant_id=tenant.pk,
        recipients=recipients,
        context=context,
        source_type=NOTIFICATION_SOURCE,
        source_id=row.pk,
    )


def _shortened(text: str, limit: int) -> str:
    return text if len(text) <= limit else f"{text[: limit - 1]}…"
