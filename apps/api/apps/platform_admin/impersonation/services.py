"""Impersonation grants (platform-admin.md §7.3, ADR-0037).

An operator takes a grant to act as one school user for 1 to
``PLATFORM_IMPERSONATION_MAX_MINUTES`` minutes, with a reason. The grant carries a handoff code,
shown once in the link the operator opens and stored only hashed; the school's dashboard trades
it, once and within ``PLATFORM_HANDOFF_CODE_TTL_SECONDS``, for an access token with no refresh
token (`exchange`). Every request on that token asks `live_grant` again, so a released,
expired or revoked grant, or a holder who lost the right to hold it, ends the session at once.

Grants are a platform table: none of this needs a school bound.
"""

from __future__ import annotations

import secrets
import uuid
from dataclasses import dataclass
from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken

from apps.platform_admin.models import ImpersonationEnd, ImpersonationGrant
from core.api.exceptions import Conflict, DomainRuleViolation
from core.rbac.impersonation import ACTOR_CLAIM, GRANT_CLAIM, IMPERSONATION_AMR, LiveGrant
from core.rbac.invitations.services import hash_token
from core.rbac.models import User, UserRole
from core.rbac.permissions import effective_permission_keys
from core.rbac.roles import PLATFORM_ROLES
from core.tenancy.models import Tenant

IMPERSONATE_KEY = "platform.tenant.impersonate"
HANDOFF_PATH = "/impersonate"
# The platform role that may end another operator's grant (§4: the console's owner role).
REVOKING_ROLE = PLATFORM_ROLES[0]


@dataclass(frozen=True)
class StartedGrant:
    grant: ImpersonationGrant
    code: str  # the raw handoff code; never stored
    superseded: list[ImpersonationGrant]


def holder_may_impersonate(user: User) -> bool:
    """The holder's standing, asked at the grant, at the exchange and on every request.

    Active, a platform user with its second factor still on (the console's own gate,
    `IsPlatformPrincipal`), and still holding ``platform.tenant.impersonate``.
    """
    return (
        user.is_active
        and user.deleted_at is None
        and user.is_platform
        and user.mfa_enabled
        and IMPERSONATE_KEY in effective_permission_keys(user)
    )


def start(
    *,
    tenant: Tenant,
    operator_id: uuid.UUID,
    target_user_id: uuid.UUID,
    reason: str,
    duration_minutes: int,
) -> StartedGrant:
    """A new grant for the operator to act as ``target_user_id``; releases their previous one.

    Refused 422 for a duration out of range or a target that is not an active, non-platform
    user of ``tenant``, and 409 for a school that is not operational (it could not be used).
    """
    maximum = settings.PLATFORM_IMPERSONATION_MAX_MINUTES
    if not 1 <= duration_minutes <= maximum:
        raise DomainRuleViolation(f"The duration must be between 1 and {maximum} minutes.")
    if not tenant.is_operational:
        raise Conflict("Only a school in trial, active or past due can be impersonated.")
    target = User.objects.filter(
        pk=target_user_id,
        tenant_id=tenant.pk,
        is_platform=False,
        is_active=True,
        deleted_at__isnull=True,
    ).first()
    if target is None:
        raise DomainRuleViolation("The user is not an active user of this school.")

    # One grant per holder at a time per person: the holder's row lock serialises two
    # concurrent requests, and `impersonation_grants_one_open_per_pair` is the backstop.
    User.objects.select_for_update().filter(pk=operator_id).first()
    now = timezone.now()
    superseded = list(
        ImpersonationGrant.objects.select_for_update().filter(
            granted_to_id=operator_id, target_user=target, released_at__isnull=True
        )
    )
    for previous in superseded:
        previous.released_at = now
        previous.end_reason = (
            ImpersonationEnd.EXPIRED if previous.expires_at <= now else ImpersonationEnd.SUPERSEDED
        )
        previous.save(update_fields=["released_at", "end_reason", "updated_at"])

    code = secrets.token_urlsafe(32)
    expires_at = now + timedelta(minutes=duration_minutes)
    handoff_expires_at = min(
        now + timedelta(seconds=settings.PLATFORM_HANDOFF_CODE_TTL_SECONDS), expires_at
    )
    grant = ImpersonationGrant.objects.create(
        tenant=tenant,
        target_user=target,
        granted_to_id=operator_id,
        reason=reason,
        expires_at=expires_at,
        handoff_code_hash=hash_token(code),
        handoff_expires_at=handoff_expires_at,
        created_by=operator_id,
    )
    return StartedGrant(grant=grant, code=code, superseded=superseded)


def _live(grant: ImpersonationGrant) -> bool:
    """Not ended, not past its time, its school operational and its holder still entitled."""
    return (
        grant.released_at is None
        and grant.expires_at > timezone.now()
        and grant.tenant.deleted_at is None
        and grant.tenant.is_operational
        and grant.target_user.is_active
        and grant.target_user.deleted_at is None
        and holder_may_impersonate(grant.granted_to)
    )


def live_grant(
    grant_id: uuid.UUID, *, target_user_id: uuid.UUID, operator_id: uuid.UUID
) -> LiveGrant | None:
    """The checker core's authenticator asks on every impersonated request (`hooks.py`)."""
    grant = (
        ImpersonationGrant.objects.select_related("tenant", "target_user", "granted_to")
        .filter(pk=grant_id, target_user_id=target_user_id, granted_to_id=operator_id)
        .first()
    )
    if grant is None or not _live(grant):
        return None
    return LiveGrant(
        grant_id=grant.pk,
        operator_id=grant.granted_to_id,
        operator_name=grant.granted_to.get_full_name(),
        expires_at=grant.expires_at,
    )


def exchange(code: str) -> tuple[ImpersonationGrant, AccessToken] | None:
    """Spend a handoff code: the grant and its access token, or None for an unusable code.

    The claim is one conditional ``UPDATE``: of two concurrent exchanges of one code, the second
    waits on the row and then matches nothing. The token has no refresh token, and expires with
    the grant (``exp = expires_at``).
    """
    now = timezone.now()
    grant = (
        ImpersonationGrant.objects.select_related("tenant", "target_user", "granted_to")
        .filter(handoff_code_hash=hash_token(code))
        .first()
    )
    if grant is None or grant.handoff_expires_at <= now or not _live(grant):
        return None
    claimed = ImpersonationGrant.objects.filter(
        pk=grant.pk, handoff_used_at__isnull=True, released_at__isnull=True
    ).update(handoff_used_at=now, updated_at=now)
    if not claimed:
        return None

    token = AccessToken.for_user(grant.target_user)
    token["tenant_id"] = str(grant.tenant_id)
    token["is_platform"] = False
    token["amr"] = [IMPERSONATION_AMR]
    token[ACTOR_CLAIM] = {"sub": str(grant.granted_to_id)}
    token[GRANT_CLAIM] = str(grant.pk)
    token.set_exp(from_time=grant.expires_at, lifetime=timedelta(0))
    return grant, token


def end(grant_id: uuid.UUID, *, reason: str) -> ImpersonationGrant | None:
    """End a grant that is still open; None if it already ended (ending twice is a no-op)."""
    now = timezone.now()
    ended = ImpersonationGrant.objects.filter(pk=grant_id, released_at__isnull=True).update(
        released_at=now, end_reason=reason, updated_at=now
    )
    if not ended:
        return None
    return ImpersonationGrant.objects.select_related("tenant", "target_user", "granted_to").get(
        pk=grant_id
    )


def may_revoke_others(user_id: uuid.UUID) -> bool:
    """A `platform_super_admin` may end any operator's grant; anyone else only their own."""
    return UserRole.objects.filter(
        user_id=user_id,
        deleted_at__isnull=True,
        role__deleted_at__isnull=True,
        role__is_platform=True,
        role__slug=REVOKING_ROLE,
    ).exists()


def close_expired() -> list[ImpersonationGrant]:
    """Record the end of every grant whose time ran out unreleased (`released_at = expires_at`)."""
    closed = []
    for grant in ImpersonationGrant.objects.select_related(
        "tenant", "target_user", "granted_to"
    ).filter(released_at__isnull=True, expires_at__lte=timezone.now()):
        ended = ImpersonationGrant.objects.filter(pk=grant.pk, released_at__isnull=True).update(
            released_at=grant.expires_at,
            end_reason=ImpersonationEnd.EXPIRED,
            updated_at=timezone.now(),
        )
        if ended:
            grant.released_at = grant.expires_at
            grant.end_reason = ImpersonationEnd.EXPIRED
            closed.append(grant)
    return closed


def count_recent(tenant_id: uuid.UUID, *, days: int = 30) -> int:
    """Grants taken for the school in the last ``days`` days (the usage snapshot's column)."""
    since = timezone.now() - timedelta(days=days)
    return ImpersonationGrant.objects.filter(tenant_id=tenant_id, created_at__gte=since).count()


def release_from_session(grant_id: uuid.UUID, *, request) -> None:
    """The hook core's logout and ``:end`` call (`core.rbac.impersonation.end_impersonation`)."""
    from apps.platform_admin.impersonation import events

    ended = end(grant_id, reason=ImpersonationEnd.RELEASED)
    if ended is not None:
        events.ended(ended, request=request)
