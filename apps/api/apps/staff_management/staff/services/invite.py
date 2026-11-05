"""`:invite` — creates or reuses a staff member's account and emails an invitation (ADR-0033)."""

from __future__ import annotations

import logging
import uuid

from django.db import transaction
from django.db.models import Q

from apps.staff_management import notifications
from apps.staff_management.models import EmploymentStatus, Staff
from core.api.exceptions import Conflict, DomainRuleViolation
from core.rbac.invitations.exceptions import AlreadyActive
from core.rbac.invitations.services import assert_email_free, create_invitation
from core.rbac.models import InvitationKind, Role, User, UserRole

logger = logging.getLogger(__name__)

EXITED_STATUSES = (
    EmploymentStatus.RESIGNED,
    EmploymentStatus.RETIRED,
    EmploymentStatus.TERMINATED,
)


def staff_invitation_eligible(user: User) -> bool:
    """The `staff` eligibility hook: the account's staff member has not exited."""
    return (
        Staff.objects.alive()
        .filter(user_id=user.pk)
        .exclude(employment_status__in=EXITED_STATUSES)
        .exists()
    )


@transaction.atomic
def invite_staff(*, staff: Staff, role_ids: list[uuid.UUID], actor_id: uuid.UUID) -> Staff:
    """Create or reuse the staff member's account and send an invitation.

    The staff row is locked first, so two concurrent invites for one person run one after
    the other: the second sees the first's account and resends instead of creating a
    duplicate user.

    - No account: create an inactive one with no usable password, assign ``role_ids``,
      link it and invite. An email already on another account here is a 409.
    - Inactive account, no usable password (invited, never accepted, including staff
      invited before invitations existed): resend. ``role_ids`` is ignored; roles change
      through role management.
    - Inactive account with a usable password (re-hired after an exit, which removed its
      roles): assign ``role_ids`` and invite again. Accepting sets a fresh password.
    - Active account: 409 ``already_active``.
    """
    staff = Staff.objects.select_for_update().get(pk=staff.pk)
    if staff.employment_status in EXITED_STATUSES:
        raise Conflict(f"This staff member has already exited ({staff.employment_status}).")

    user = None
    if staff.user_id is not None:
        user = User.objects.filter(
            pk=staff.user_id, tenant_id=staff.tenant_id, deleted_at__isnull=True
        ).first()

    if user is not None:
        if user.is_active:
            raise AlreadyActive()
        if user.has_usable_password():
            _assign_roles(user=user, role_ids=role_ids, tenant_id=staff.tenant_id)
        create_invitation(user=user, kind=InvitationKind.STAFF, actor_id=actor_id)
        return staff

    if not staff.email:
        raise DomainRuleViolation(
            {"non_field": "An email address is required to invite this staff member."}
        )
    assert_email_free(tenant_id=staff.tenant_id, email=staff.email)

    user = User.objects.create(
        tenant_id=staff.tenant_id,
        email=staff.email,
        first_name=staff.first_name,
        last_name=staff.last_name,
        phone=staff.phone,
        is_active=False,
    )
    user.set_unusable_password()
    user.save(update_fields=["password"])
    _assign_roles(user=user, role_ids=role_ids, tenant_id=staff.tenant_id)

    staff.user_id = user.pk
    staff.updated_by = actor_id
    staff.save(update_fields=["user_id", "updated_by", "updated_at"])

    create_invitation(user=user, kind=InvitationKind.STAFF, actor_id=actor_id)
    _notify_invited(staff=staff, user_id=user.pk)
    return staff


def _assign_roles(*, user: User, role_ids: list[uuid.UUID], tenant_id: uuid.UUID) -> None:
    # A role_id may name either a tenant-custom role or a platform-seeded
    # default role (Role.tenant is null for those) — both are valid targets.
    roles = list(
        Role.objects.filter(pk__in=role_ids).filter(Q(tenant_id=tenant_id) | Q(tenant__isnull=True))
    )
    if len(roles) != len(set(role_ids)):
        raise DomainRuleViolation(
            {"role_ids": "One or more role ids do not exist for your school."}
        )
    held = set(UserRole.objects.filter(user=user).values_list("role_id", flat=True))
    UserRole.objects.bulk_create(
        [
            UserRole(user=user, role=role, tenant_id=tenant_id)
            for role in roles
            if role.pk not in held
        ]
    )


def _notify_invited(*, staff: Staff, user_id: uuid.UUID) -> None:
    """Emit `staff.invited`. Never lets a notification failure undo the invite.

    In-app only: the invitation email itself goes through `core.rbac.auth_emails`, never
    `notify()`, because a rendered link must not be persisted (ADR-0033). The account and
    its role assignments are the actual outcome of `:invite`, so a template or transport
    problem must not roll them back; this swallows and logs, savepointed for the same
    reason as `core.audit.services.record_audit`.
    """
    from core.notifications.services import Recipient, notify
    from core.tenancy.models import Tenant

    try:
        with transaction.atomic():
            notify(
                notifications.STAFF_INVITED,
                tenant_id=staff.tenant_id,
                recipients=[Recipient(user_id=user_id)],
                context={
                    "staff.first_name": staff.first_name,
                    "school.name": Tenant.objects.get(pk=staff.tenant_id).name,
                },
                source_type="staff",
                source_id=staff.pk,
            )
    except Exception:
        logger.exception("staff.invited notification failed for staff %s", staff.pk)
