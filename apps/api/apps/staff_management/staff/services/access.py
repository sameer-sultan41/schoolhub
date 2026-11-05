"""Ending a staff member's login when they leave, by `:exit` or by `DELETE` (ADR-0033)."""

from __future__ import annotations

import logging
import uuid

from apps.staff_management.models import Staff

logger = logging.getLogger(__name__)


def end_staff_access(staff: Staff, *, actor_id: uuid.UUID, reason: str) -> None:
    """Deactivate a departed staff member's login, unless it is someone else's too.

    A departed employee must not keep portal access or role assignments. Their role
    assignments are hard-deleted rather than soft-deleted (``deleted_at``), so a re-hire
    starts from no roles. A pending invitation and a held refresh token would each let them
    back in, so both go too (ADR-0033). A login also linked to a guardian or student
    (linked before `user_id` became read-only, or by hand) is that person's account: only
    its staff roles are removed, the staff row is unlinked, and its portal roles, active
    flag, invitations and tokens are left alone. ``reason`` (``exit``, ``delete``) is logged.
    """
    from apps.student_management.models import Guardian, Student
    from apps.student_management.portal_accounts.services import DEACTIVATED_EVENT
    from core.audit.services import record_task_security_event
    from core.rbac.cache import evict_rbac_caches
    from core.rbac.invitations.services import revoke_pending_invitations
    from core.rbac.models import InvitationKind, User, UserRole
    from core.rbac.sessions import revoke_refresh_tokens

    user_id = staff.user_id
    if user_id is None:
        return
    if (
        Guardian.objects.alive().filter(user_id=user_id).exists()
        or Student.objects.alive().filter(user_id=user_id).exists()
    ):
        logger.warning(
            "staff %s %s: its login %s is also a guardian or student account; staff "
            "roles removed and unlinked, not deactivated",
            staff.pk,
            reason,
            user_id,
        )
        UserRole.objects.filter(
            user_id=user_id, tenant_id=staff.tenant_id, role__is_restricted_principal=False
        ).delete()
        evict_rbac_caches([user_id])
        staff.user_id = None
        staff.updated_by = actor_id
        staff.save(update_fields=["user_id", "updated_by", "updated_at"])
        return

    deactivated = User.objects.filter(pk=user_id, is_active=True).update(is_active=False)
    UserRole.objects.filter(user_id=user_id, tenant_id=staff.tenant_id).delete()
    evict_rbac_caches([user_id])
    revoked = revoke_pending_invitations(user_id)
    revoke_refresh_tokens(user_id)
    if deactivated or revoked:
        record_task_security_event(
            DEACTIVATED_EVENT,
            tenant_id=staff.tenant_id,
            actor_id=actor_id,
            resource_id=user_id,
            kind=InvitationKind.STAFF,
            reason=reason,
            revoked_invitations=revoked,
        )
