"""Forgotten-password reset by emailed link (ADR-0033).

The request endpoint never looks the email up: it queues a task for any known school and
answers 204, so an unknown, inactive or platform address takes the same path and the same
time as a real one. The task does the lookup and sends only to an active member of that
school. Only active users can reset; an invited account activates through its invitation.
"""

from __future__ import annotations

import logging
import uuid

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from rest_framework import serializers

from core.api.exceptions import InvalidLink
from core.rbac.account_links import account_link
from core.rbac.auth_emails import PASSWORD_CHANGED, PASSWORD_RESET, send_auth_email
from core.rbac.models import User
from core.rbac.password_reset.tokens import reset_token_generator
from core.rbac.sessions import revoke_refresh_tokens
from core.tenancy.context import tenant_atomic
from core.tenancy.models import Tenant

logger = logging.getLogger(__name__)

RESET_PATH = "/reset-password"


def _active_members(tenant_id: uuid.UUID):
    """Users who may reset at this school. ``users`` has no RLS, so the tenant is explicit."""
    return User.objects.filter(
        tenant_id=tenant_id, is_active=True, is_platform=False, deleted_at__isnull=True
    )


def request_password_reset(*, tenant: Tenant, email: str) -> None:
    """Queue the reset email once this commits, whether or not the address exists."""
    from core.rbac.password_reset.tasks import send_password_reset_email

    tenant_id = str(tenant.id)
    transaction.on_commit(lambda: send_password_reset_email.delay(tenant_id=tenant_id, email=email))


def deliver_password_reset(*, tenant_id: uuid.UUID, email: str) -> bool:
    """Email a reset link to the one active member with this address. False otherwise."""
    with tenant_atomic(tenant_id):
        tenant = Tenant.objects.get(pk=tenant_id)
        # Emails are unique per school but compared case-sensitively by that constraint;
        # an address matching two accounts by case is ambiguous, so nobody gets a link.
        matches = list(_active_members(tenant_id).filter(email__iexact=email.strip())[:2])
    if len(matches) > 1:
        # Both holders are locked out of reset until an admin fixes one address; say so.
        logger.warning(
            "password reset skipped: users %s share an address differing only by case",
            ", ".join(str(match.pk) for match in matches),
        )
    if len(matches) != 1:
        return False
    user = matches[0]
    link = account_link(
        tenant,
        RESET_PATH,
        uid=urlsafe_base64_encode(force_bytes(user.pk)),
        token=reset_token_generator.make_token(user),
    )
    send_auth_email(
        PASSWORD_RESET,
        to=user.email,
        context={
            "name": user.get_full_name(),
            "school_name": tenant.name,
            "link": link,
            "expires_in_minutes": settings.PASSWORD_RESET_TIMEOUT // 60,
        },
    )
    return True


def _user_from_uid(tenant: Tenant, uid: str) -> User | None:
    try:
        user_id = uuid.UUID(force_str(urlsafe_base64_decode(uid)))
    except ValueError, TypeError:
        return None
    # Locked: a concurrent confirm with the same token waits, then sees the new password
    # hash, which the token no longer matches, so a link is spent once.
    return _active_members(tenant.id).select_for_update().filter(pk=user_id).first()


def confirm_password_reset(*, tenant: Tenant, uid: str, token: str, new_password: str) -> User:
    """Set the new password, end every session and tell the account holder."""
    from core.rbac.password_reset.tasks import send_password_changed_email

    user = _user_from_uid(tenant, uid)
    if user is None or not reset_token_generator.check_token(user, token):
        raise InvalidLink()
    try:
        validate_password(new_password, user)
    except DjangoValidationError as exc:
        raise serializers.ValidationError({"new_password": list(exc.messages)}) from exc

    user.set_password(new_password)
    user.save(update_fields=["password", "updated_at"])
    revoke_refresh_tokens(user.id)
    tenant_id, user_id = str(tenant.id), str(user.id)
    transaction.on_commit(
        lambda: send_password_changed_email.delay(tenant_id=tenant_id, user_id=user_id)
    )
    return user


def deliver_password_changed(*, tenant_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    with tenant_atomic(tenant_id):
        tenant = Tenant.objects.get(pk=tenant_id)
        user = User.objects.filter(tenant_id=tenant_id, pk=user_id).first()
    if user is None:
        return False
    send_auth_email(
        PASSWORD_CHANGED,
        to=user.email,
        context={"name": user.get_full_name(), "school_name": tenant.name},
    )
    return True
