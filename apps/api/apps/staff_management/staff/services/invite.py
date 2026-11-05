"""`:invite` — creates or reuses a staff member's account and emails an invitation (ADR-0033)."""

from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING

from django.db import transaction
from django.db.models import Q
from rest_framework.exceptions import PermissionDenied

from apps.staff_management import notifications
from apps.staff_management.models import EmploymentStatus, Staff
from core.api.exceptions import Conflict, DomainRuleViolation
from core.rbac.cache import evict_rbac_caches
from core.rbac.invitations.exceptions import AlreadyActive, EmailInUse
from core.rbac.invitations.services import (
    assert_email_free,
    create_invitation,
    create_invited_user,
    readdress_pending_account,
)
from core.rbac.models import InvitationKind, Permission, RecordScope, Role, User, UserRole
from core.rbac.permissions import live_restricted_role_assignments, scope_grants

if TYPE_CHECKING:
    from django.contrib.auth.base_user import AbstractBaseUser
    from django.contrib.auth.models import AnonymousUser

    type Actor = AbstractBaseUser | AnonymousUser

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
def invite_staff(*, staff: Staff, role_ids: list[uuid.UUID], actor: Actor) -> Staff:
    """Create or reuse the staff member's account and send an invitation.

    The staff row is locked first, so two concurrent invites for one person run one after
    the other: the second sees the first's account and resends instead of creating a
    duplicate user.

    ``role_ids`` that are assigned must be grantable by ``actor``: no student or guardian
    role, and no role holding a key ``actor`` does not hold at scope ``all``, the scope the
    new assignment gets (403, nothing assigned or sent). Otherwise ``staff.staff.update``
    alone could mint a login stronger than the inviter's.

    - No account: create an inactive one with no usable password, assign ``role_ids``,
      link it and invite. An email already on another account here is a 409.
    - Inactive account, no usable password (invited, never accepted, including staff
      invited before invitations existed): resend, to ``Staff.email`` if it was corrected
      since (``readdress_pending_account``). ``role_ids`` is ignored; roles change through
      role management.
    - Account that is a guardian's or student's login, or holds a restricted role: 409
      ``email_in_use``, nothing assigned.
    - Inactive account with a usable password (re-hired after an exit, which removed its
      roles): assign ``role_ids`` and invite again. Accepting sets a fresh password.
    - Active account: 409 ``already_active``.
    """
    actor_id = actor.pk
    staff = Staff.objects.select_for_update().get(pk=staff.pk)
    if staff.employment_status in EXITED_STATUSES:
        raise Conflict(f"This staff member has already exited ({staff.employment_status}).")

    user = None
    if staff.user_id is not None:
        user = User.objects.filter(
            pk=staff.user_id, tenant_id=staff.tenant_id, deleted_at__isnull=True
        ).first()

    if user is not None:
        if _is_portal_login(user):
            # Someone else's guardian or student login, linked before `user_id` was
            # read-only: inviting would hand staff roles to a portal account.
            raise EmailInUse()
        if user.is_active:
            raise AlreadyActive()
        if user.has_usable_password():
            roles = _grantable_roles(role_ids=role_ids, tenant_id=staff.tenant_id, actor=actor)
            _assign_roles(user=user, roles=roles, tenant_id=staff.tenant_id)
        else:
            readdress_pending_account(user=user, email=staff.email)
        create_invitation(user=user, kind=InvitationKind.STAFF, actor_id=actor_id)
        return staff

    if not staff.email:
        raise DomainRuleViolation(
            {"non_field": "An email address is required to invite this staff member."}
        )
    assert_email_free(tenant_id=staff.tenant_id, email=staff.email)
    roles = _grantable_roles(role_ids=role_ids, tenant_id=staff.tenant_id, actor=actor)

    user = create_invited_user(
        tenant_id=staff.tenant_id,
        email=staff.email,
        first_name=staff.first_name,
        last_name=staff.last_name,
        phone=staff.phone,
    )
    _assign_roles(user=user, roles=roles, tenant_id=staff.tenant_id)

    staff.user_id = user.pk
    staff.updated_by = actor_id
    staff.save(update_fields=["user_id", "updated_by", "updated_at"])

    create_invitation(user=user, kind=InvitationKind.STAFF, actor_id=actor_id)
    _notify_invited(staff=staff, user_id=user.pk)
    return staff


def _is_portal_login(user: User) -> bool:
    """Whether ``user`` is a guardian's or student's login, or holds a restricted role."""
    from apps.student_management.models import Guardian, Student

    return (
        Guardian.objects.alive().filter(user_id=user.pk).exists()
        or Student.objects.alive().filter(user_id=user.pk).exists()
        or live_restricted_role_assignments().filter(user_id=user.pk).exists()
    )


def _grantable_roles(
    *, role_ids: list[uuid.UUID], tenant_id: uuid.UUID, actor: Actor
) -> list[Role]:
    """The roles ``role_ids`` names, if ``actor`` may hand every one of them out.

    A role_id may name either a tenant-custom role or a platform-seeded default role
    (Role.tenant is null for those); both are valid targets. A student or guardian role is
    never a staff role, and a role carrying a key the actor does not hold at scope ``all``
    would let the actor grant more than they have, so either is a 403. Scope ``all`` because
    the new assignment is made at ``all``: a campus-scoped holder of a key cannot hand out
    the whole school's reach of it.
    """
    roles = list(
        Role.objects.filter(pk__in=role_ids).filter(Q(tenant_id=tenant_id) | Q(tenant__isnull=True))
    )
    if len(roles) != len(set(role_ids)):
        raise DomainRuleViolation(
            {"role_ids": "One or more role ids do not exist for your school."}
        )
    if any(role.is_restricted_principal for role in roles):
        raise PermissionDenied("A student or guardian role can't be given to a staff member.")
    granted = set(Permission.objects.filter(roles__in=roles).values_list("key", flat=True))
    held_school_wide = {
        key for key, by_scope in scope_grants(actor).items() if RecordScope.ALL in by_scope
    }
    if granted - held_school_wide:
        raise PermissionDenied("You can't give a role with permissions you don't hold yourself.")
    return roles


def _assign_roles(*, user: User, roles: list[Role], tenant_id: uuid.UUID) -> None:
    held = set(UserRole.objects.filter(user=user).values_list("role_id", flat=True))
    UserRole.objects.bulk_create(
        [
            UserRole(user=user, role=role, tenant_id=tenant_id)
            for role in roles
            if role.pk not in held
        ]
    )
    # `bulk_create` sends no post_save, so core/rbac/signals.py never hears of these.
    evict_rbac_caches([user.pk])


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
