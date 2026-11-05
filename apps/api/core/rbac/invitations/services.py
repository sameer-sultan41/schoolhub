"""Creating, sending, previewing and accepting account invitations (ADR-0033).

Every function here runs with the invitation's tenant bound: a view inside
``tenant_context(tenant.id)``, a task inside ``tenant_atomic(tenant_id)``. ``invitations``
has an RLS policy, so another school's token is simply not found. ``users`` has none, so
user lookups also filter on ``tenant_id``.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import timedelta

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from core.api.exceptions import InvalidLink
from core.audit.services import record_task_security_event
from core.rbac.account_links import account_link
from core.rbac.auth_emails import INVITATION, send_auth_email
from core.rbac.invitations.eligibility import is_eligible
from core.rbac.models import Invitation, InvitationStatus, User
from core.tenancy.context import tenant_atomic
from core.tenancy.models import Tenant

INVITATION_TTL = timedelta(hours=72)
ACCEPT_PATH = "/accept-invite"


def hash_token(raw: str) -> str:
    """SHA-256 hex of a raw token: the only form of it the database ever holds."""
    return hashlib.sha256(raw.encode()).hexdigest()


def revoke_pending_invitations(user_id: uuid.UUID) -> int:
    """Revoke every unaccepted, unrevoked invitation for ``user_id``. Returns how many."""
    return Invitation.objects.filter(
        user_id=user_id, accepted_at__isnull=True, revoked_at__isnull=True
    ).update(revoked_at=timezone.now(), updated_at=timezone.now())


def create_invitation(*, user: User, kind: str, actor_id: uuid.UUID | None) -> Invitation:
    """Replace ``user``'s pending invitations with a new one and send it once this commits.

    The token does not exist yet: the send task creates it, so it never sits in this row
    or in the broker message.
    """
    from core.rbac.invitations.tasks import send_invitation_email

    # Serialises invites for one user: a concurrent second invite waits here, then its
    # revoke sees this one's committed row, so only one invitation is ever pending.
    User.objects.select_for_update().filter(pk=user.pk).first()
    revoke_pending_invitations(user.id)
    invitation = Invitation.objects.create(
        tenant_id=user.tenant_id,
        user=user,
        kind=kind,
        expires_at=timezone.now() + INVITATION_TTL,
        created_by=actor_id,
        updated_by=actor_id,
    )
    tenant_id, invitation_id = str(user.tenant_id), str(invitation.id)
    transaction.on_commit(
        lambda: send_invitation_email.delay(tenant_id=tenant_id, invitation_id=invitation_id)
    )
    return invitation


def deliver_invitation(*, tenant_id: uuid.UUID, invitation_id: uuid.UUID) -> bool:
    """Mint a fresh token, store its hash, and email the link. False if nothing to send.

    The hash commits before the email goes out, so the link works the moment it arrives.
    A retry mints another token, which replaces the hash and kills any earlier link.
    """
    with tenant_atomic(tenant_id):
        invitation = (
            Invitation.objects.select_for_update(of=("self",))
            .select_related("user")
            .filter(pk=invitation_id)
            .first()
        )
        # Revoked or accepted while queued: a resend has already taken over.
        if invitation is None or invitation.accepted_at or invitation.revoked_at:
            return False
        tenant = Tenant.objects.get(pk=tenant_id)
        raw = secrets.token_urlsafe(32)
        now = timezone.now()
        invitation.token_hash = hash_token(raw)
        invitation.sent_at = now
        invitation.expires_at = now + INVITATION_TTL
        invitation.send_failed_at = None
        invitation.save(
            update_fields=["token_hash", "sent_at", "expires_at", "send_failed_at", "updated_at"]
        )
        user = invitation.user

    send_auth_email(
        INVITATION,
        to=user.email,
        context={
            "name": user.get_full_name(),
            "school_name": tenant.name,
            "link": account_link(tenant, ACCEPT_PATH, token=raw),
            "expires_in_hours": int(INVITATION_TTL.total_seconds() // 3600),
        },
    )
    record_task_security_event(
        "auth.invitation.sent",
        tenant_id=tenant_id,
        resource_id=invitation_id,
        user_id=str(user.id),
        kind=invitation.kind,
    )
    return True


def mark_send_failed(*, tenant_id: uuid.UUID, invitation_id: uuid.UUID, error: str) -> None:
    """Record that the email never went out. Any half-issued link dies with the hash."""
    with tenant_atomic(tenant_id):
        updated = Invitation.objects.filter(
            pk=invitation_id, accepted_at__isnull=True, revoked_at__isnull=True
        ).update(send_failed_at=timezone.now(), token_hash="", updated_at=timezone.now())
    if updated:
        record_task_security_event(
            "auth.invitation.send_failed",
            tenant_id=tenant_id,
            resource_id=invitation_id,
            error=error[:200],
        )


def _usable_invitation(tenant: Tenant, raw_token: str, *, lock: bool) -> Invitation:
    """The pending invitation behind ``raw_token`` at this school, or ``InvalidLink``.

    Every refusal is the same 400, whatever the reason, so the endpoint cannot be used to
    learn which accounts or invitations exist.
    """
    queryset = Invitation.objects.select_related("user")
    if lock:
        queryset = queryset.select_for_update()
    invitation = queryset.filter(token_hash=hash_token(raw_token)).first()
    if invitation is None or invitation.status != InvitationStatus.PENDING:
        raise InvalidLink()
    user = invitation.user
    if user.tenant_id != tenant.id or user.is_platform or user.deleted_at is not None:
        raise InvalidLink()
    if not is_eligible(user, invitation.kind):
        raise InvalidLink()
    return invitation


def preview_invitation(*, tenant: Tenant, raw_token: str) -> dict[str, object]:
    """What the accept page shows before the person sets a password."""
    invitation = _usable_invitation(tenant, raw_token, lock=False)
    return {
        "email": invitation.user.email,
        "school_name": tenant.name,
        "expires_at": invitation.expires_at,
    }


def accept_invitation(*, tenant: Tenant, raw_token: str, password: str) -> User:
    """Set the password, activate the account and spend the invitation."""
    invitation = _usable_invitation(tenant, raw_token, lock=True)
    user = invitation.user
    try:
        validate_password(password, user)
    except DjangoValidationError as exc:
        raise serializers.ValidationError({"password": list(exc.messages)}) from exc

    user.set_password(password)
    user.is_active = True
    user.save(update_fields=["password", "is_active", "updated_at"])
    invitation.accepted_at = timezone.now()
    invitation.save(update_fields=["accepted_at", "updated_at"])
    return user
