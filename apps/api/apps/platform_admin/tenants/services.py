"""Tenant creation, provisioning and the lifecycle actions behind `/platform/tenants`.

`create_tenant` works on the platform-scope ``tenants`` table alone and needs no tenant
bound. Everything else touches one school's own rows (settings, its owner's invitation,
its jobs), so it runs with that school bound: the console's nested routes bind it for the
whole request (`core.api.platform.PlatformTenantNestedMixin`).
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import serializers

from apps.fees_finance.services import ensure_system_accounts
from apps.platform_admin.constants import RESERVED_SLUGS, SLUG_PATTERN, TENANT_EXPORT_JOB_TYPE
from apps.platform_admin.tenants import lifecycle
from core.api.exceptions import CodedAPIException, DomainRuleViolation
from core.jobs.models import BackgroundJob, JobStatus
from core.rbac.cache import evict_rbac_caches
from core.rbac.invitations.services import (
    assert_email_free,
    create_invitation,
    create_invited_user,
)
from core.rbac.models import InvitationKind, Role, User, UserRole
from core.rbac.roles import SCHOOL_OWNER
from core.tenancy import subscription_state
from core.tenancy.context import tenant_context
from core.tenancy.models import Tenant, TenantSettings, TenantStatus

S = TenantStatus

SLUG_FORMAT = "Use lowercase letters, digits and hyphens, and start and end with no hyphen."
SLUG_RESERVED = "This name is reserved for the platform's own sites."
SLUG_TAKEN = "Another school already uses this slug."
SLUG_FROZEN = "The slug cannot change once the school is provisioned."
TRIAL_END_PAST = "The trial must end in the future."
TRIAL_END_REQUIRED = "A trial end is required to reinstate a school on a trial."

_SLUG = re.compile(SLUG_PATTERN)

# The fields `PATCH /platform/tenants/{id}` may change.
EDITABLE_FIELDS = ("name", "slug", "contact_name", "contact_email", "contact_phone")


class NoLiveSubscription(CodedAPIException):
    status_code = 409
    default_detail = (
        "This school has no live subscription to reinstate it to. Give a future "
        "trial_ends_at to reinstate it on a trial."
    )
    default_code = "no_live_subscription"


class ExportRequired(CodedAPIException):
    status_code = 409
    default_detail = "Export this school's data before deleting it, or waive the export explicitly."
    default_code = "export_required"


def slug_errors(slug: str, *, tenant: Tenant | None = None) -> list[str]:
    """Why ``slug`` cannot name a school (``tenant``, when renaming one), or nothing."""
    if not _SLUG.match(slug):
        return [SLUG_FORMAT]
    if slug in RESERVED_SLUGS:
        return [SLUG_RESERVED]
    taken = Tenant.objects.filter(slug=slug)
    if tenant is not None:
        taken = taken.exclude(pk=tenant.pk)
    return [SLUG_TAKEN] if taken.exists() else []


def create_tenant(
    *,
    name: str,
    slug: str,
    contact_name: str,
    contact_email: str,
    contact_phone: str = "",
    actor_id: uuid.UUID | None,
) -> Tenant:
    """A new school in ``provisioning``: just the row, nothing seeded until `:provision`.

    Idempotent by its unique slug, so it needs no ``Idempotency-Key``: a retry is refused
    with the slug's 400 instead of creating a second school.
    """
    errors = slug_errors(slug)
    if errors:
        raise serializers.ValidationError({"slug": errors})
    try:
        with transaction.atomic():
            return Tenant.objects.create(
                name=name,
                slug=slug,
                status=S.PROVISIONING,
                contact_name=contact_name,
                contact_email=contact_email,
                contact_phone=contact_phone,
                created_by=actor_id,
                updated_by=actor_id,
            )
    except IntegrityError as exc:
        # Two creates racing for one slug: the unique index refuses the second.
        raise serializers.ValidationError({"slug": [SLUG_TAKEN]}) from exc


@transaction.atomic
def update_tenant(tenant: Tenant, *, data: dict, actor_id: uuid.UUID | None) -> Tenant:
    """Change the editable fields in ``data``. The slug is frozen once provisioned (§11)."""
    locked = Tenant.objects.select_for_update().get(pk=tenant.pk)
    slug = data.get("slug")
    if slug is not None and slug != locked.slug:
        if locked.status != S.PROVISIONING:
            raise serializers.ValidationError({"slug": [SLUG_FROZEN]})
        errors = slug_errors(slug, tenant=locked)
        if errors:
            raise serializers.ValidationError({"slug": errors})
    fields = [field for field in EDITABLE_FIELDS if field in data]
    for field in fields:
        setattr(locked, field, data[field])
    locked.updated_by = actor_id
    try:
        with transaction.atomic():
            locked.save(update_fields=[*fields, "updated_by", "updated_at"])
    except IntegrityError as exc:
        raise serializers.ValidationError({"slug": [SLUG_TAKEN]}) from exc
    return locked


@transaction.atomic
def provision_tenant(
    tenant: Tenant, *, plan_code: str | None, actor_id: uuid.UUID | None
) -> Tenant:
    """Seed a ``provisioning`` school and start its trial, in one transaction.

    - creates its `TenantSettings` row and its system ledger accounts
      (`fees_finance.services.ensure_system_accounts`), so its first fee head has an
      income account to map to;
    - creates the owner's account from the contact details (inactive, no password), gives
      it the shared `school_owner` default role, and invites it (`InvitationKind.OWNER`,
      emailed once this commits, linking to the school's own dashboard host);
    - sets ``trial_ends_at`` (``PLATFORM_DEFAULT_TRIAL_DAYS``) and ``provisioned_at``;
    - moves the school to ``trial``.

    The tenant row is locked first and must still be ``provisioning``, so a second call,
    concurrent or not, is a 409 ``invalid_transition`` with nothing seeded twice. The default
    staff roles need no seeding: they are shared ``tenant=None`` rows (`sync_default_roles`).

    ``plan_code`` is refused (422) until plans exist (PR B), so no caller relies on a plan
    being silently ignored.
    """
    if plan_code is not None:
        raise DomainRuleViolation(
            {"plan_code": "Plans are not available yet. Provision without a plan."}
        )
    locked = Tenant.objects.select_for_update().get(pk=tenant.pk)
    lifecycle.assert_can_transition(locked, S.TRIAL)
    if not locked.contact_email:
        raise DomainRuleViolation(
            {"contact_email": "The owner is invited at the contact email; add one first."}
        )

    with tenant_context(locked.pk):
        TenantSettings.objects.get_or_create(tenant=locked)
        ensure_system_accounts(tenant_id=locked.pk)
        owner = _create_owner(locked)
        create_invitation(user=owner, kind=InvitationKind.OWNER, actor_id=actor_id)

        now = timezone.now()
        locked.trial_ends_at = now + timedelta(days=settings.PLATFORM_DEFAULT_TRIAL_DAYS)
        locked.provisioned_at = now
        locked.save(update_fields=["trial_ends_at", "provisioned_at", "updated_at"])
        return lifecycle.transition(locked, S.TRIAL, actor_id=actor_id)


def _create_owner(tenant: Tenant) -> User:
    """The owner's inactive account, holding the shared `school_owner` role at this school.

    ``contact_name`` splits on its first space: the rest, possibly empty, is the last name.
    """
    first_name, _, last_name = tenant.contact_name.strip().partition(" ")
    assert_email_free(tenant_id=tenant.pk, email=tenant.contact_email)
    owner = create_invited_user(
        tenant_id=tenant.pk,
        email=tenant.contact_email,
        first_name=first_name,
        last_name=last_name.strip(),
        phone=tenant.contact_phone,
    )
    # Synced on every migrate (`sync_default_roles`); missing means a broken database.
    role = Role.objects.get(tenant=None, slug=SCHOOL_OWNER, deleted_at__isnull=True)
    UserRole.objects.create(user=owner, role=role, tenant_id=tenant.pk)
    evict_rbac_caches([owner.pk])
    return owner


def owner_invitation_eligible(user: User) -> bool:
    """The `owner` invitation's eligibility hook: the account still holds `school_owner`."""
    return (
        user.deleted_at is None
        and UserRole.objects.filter(
            user_id=user.pk,
            deleted_at__isnull=True,
            role__slug=SCHOOL_OWNER,
            role__deleted_at__isnull=True,
        ).exists()
    )


def suspend_tenant(tenant: Tenant, *, reason: str, actor_id: uuid.UUID | None) -> Tenant:
    return lifecycle.transition(tenant, S.SUSPENDED, actor_id=actor_id, reason=reason)


@transaction.atomic
def reinstate_tenant(
    tenant: Tenant,
    *,
    trial_ends_at: datetime | None,
    actor_id: uuid.UUID | None,
    reason: str = "",
) -> Tenant:
    """Return a suspended school to the status its live subscription implies.

    - an ``active`` subscription: ``active``; a ``past_due`` one: ``past_due``;
    - a ``trialing`` one, or none: ``trial``, and only with a future ``trial_ends_at``,
      which becomes the school's trial end;
    - no live subscription and no ``trial_ends_at``: 409 ``no_live_subscription``.

    The live subscription comes from the registered ``subscription_state`` hook; with none
    registered (before plans exist) every school counts as having none.
    """
    if tenant.status != S.SUSPENDED:
        # Judged before the subscription, so reinstating a live school is a plain 409.
        raise lifecycle.InvalidTransition(meta={"from": tenant.status, "to": "reinstated"})

    state = subscription_state.live_subscription_state(tenant)
    if state == subscription_state.ACTIVE:
        target = S.ACTIVE
    elif state == subscription_state.PAST_DUE:
        target = S.PAST_DUE
    else:
        _check_trial_end(trial_ends_at, trialing=state == subscription_state.TRIALING)
        target = S.TRIAL

    moved = lifecycle.transition(tenant, target, actor_id=actor_id, reason=reason)
    if target == S.TRIAL:
        moved.trial_ends_at = trial_ends_at
        moved.save(update_fields=["trial_ends_at", "updated_at"])
    return moved


def _check_trial_end(trial_ends_at: datetime | None, *, trialing: bool) -> None:
    """A reinstatement on a trial needs a future trial end (409 without any subscription)."""
    if trial_ends_at is None:
        if trialing:
            raise serializers.ValidationError({"trial_ends_at": [TRIAL_END_REQUIRED]})
        raise NoLiveSubscription()
    if trial_ends_at <= timezone.now():
        raise serializers.ValidationError({"trial_ends_at": [TRIAL_END_PAST]})


@transaction.atomic
def delete_tenant(
    tenant: Tenant, *, reason: str, waive_export: bool, actor_id: uuid.UUID | None
) -> Tenant:
    """Start deprovisioning: the retention window, then the purge (§7).

    A school that went live (``active`` or ``suspended``) needs a succeeded export of its
    data first, or an explicit ``waive_export``. One still ``provisioning`` was created by
    mistake and has nothing to export.
    """
    locked = Tenant.objects.select_for_update().get(pk=tenant.pk)
    went_live = locked.status in (S.ACTIVE, S.SUSPENDED)
    if went_live and not waive_export and not has_succeeded_export(locked):
        raise ExportRequired()
    return lifecycle.transition(locked, S.DEPROVISIONED, actor_id=actor_id, reason=reason)


def has_succeeded_export(tenant: Tenant) -> bool:
    """Whether a full export of ``tenant`` ever succeeded. The job row is under RLS."""
    with tenant_context(tenant.pk):
        return BackgroundJob.objects.filter(
            job_type=TENANT_EXPORT_JOB_TYPE, status=JobStatus.SUCCEEDED
        ).exists()


def restore_tenant(tenant: Tenant, *, reason: str, actor_id: uuid.UUID | None) -> Tenant:
    """Undo a deprovision inside the retention window. The school comes back suspended."""
    return lifecycle.transition(tenant, S.SUSPENDED, actor_id=actor_id, reason=reason)
