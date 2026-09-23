"""`:invite` — creates and links a portal account, then assigns roles."""

from __future__ import annotations

import logging
import uuid

from django.db import transaction

from apps.staff_management import notifications
from apps.staff_management.models import EmploymentStatus, Staff
from core.api.exceptions import Conflict, DomainRuleViolation

logger = logging.getLogger(__name__)


@transaction.atomic
def invite_staff(*, staff: Staff, role_ids: list[uuid.UUID], actor_id: uuid.UUID) -> Staff:
    """Create the tenant-scoped portal account and link + role-assign it.

    Emits ``staff.invited`` through ``core.notifications``, which now exists —
    but **in-app only**, and the remaining gap is worth stating precisely rather
    than calling this done. The account is still inactive (``is_active=False``)
    with an unusable password, because no set-password/SSO onboarding flow exists
    yet; an *email* saying "your account is ready" would therefore be untrue, so
    the trigger deliberately does not declare that channel (see
    ``notifications.py``). The inbox entry is honest — it is waiting for the
    recipient when they can first sign in.

    What is still missing is the onboarding flow itself, not the notification
    layer: an activation token endpoint plus the email that carries it. Adding
    ``NotificationChannel.EMAIL`` to the trigger is the one-line change once it
    lands. Documented in the same honest style as
    ``core.files.File.av_scanned_at``'s "no scanner is wired up yet".
    """
    if staff.user_id is not None:
        raise Conflict("This staff member already has a linked account.")
    if staff.employment_status in (
        EmploymentStatus.RESIGNED,
        EmploymentStatus.RETIRED,
        EmploymentStatus.TERMINATED,
    ):
        raise Conflict(f"This staff member has already exited ({staff.employment_status}).")

    from django.db.models import Q

    from core.rbac.models import Role, User, UserRole

    if not staff.email:
        raise DomainRuleViolation(
            {"non_field": "An email address is required to invite this staff member."}
        )

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

    # A role_id may name either a tenant-custom role or a platform-seeded
    # default role (Role.tenant is null for those) — both are valid targets.
    roles = list(
        Role.objects.filter(pk__in=role_ids).filter(
            Q(tenant_id=staff.tenant_id) | Q(tenant__isnull=True)
        )
    )
    if len(roles) != len(set(role_ids)):
        raise DomainRuleViolation(
            {"role_ids": "One or more role ids do not exist for your school."}
        )
    UserRole.objects.bulk_create(
        [UserRole(user=user, role=role, tenant_id=staff.tenant_id) for role in roles]
    )

    staff.user_id = user.pk
    staff.updated_by = actor_id
    staff.save(update_fields=["user_id", "updated_by", "updated_at"])

    _notify_invited(staff=staff, user_id=user.pk)
    return staff


def _notify_invited(*, staff: Staff, user_id: uuid.UUID) -> None:
    """Emit `staff.invited`. Never lets a notification failure undo the invite.

    The account and its role assignments are the actual outcome of `:invite`;
    a template or transport problem must not roll those back, so this swallows
    and logs rather than propagating — the same reasoning as
    `core.audit.services.record_audit`, which is also savepointed for it.
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
