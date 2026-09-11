"""`:exit` — clearance checks (module doc §7, §11) and the status transition."""

from __future__ import annotations

import uuid
from datetime import date

from django.db import transaction

from apps.staff_management.models import EmploymentStatus, Staff
from core.api.exceptions import Conflict, DomainRuleViolation


def is_sole_class_teacher(*, staff: Staff) -> bool:
    """§11: exit is blocked while the staff member is the sole class teacher

    for any section — imported lazily to avoid a hard import-time dependency
    on school_organization beyond what the module doc already declares.
    """
    from apps.school_organization.models import Section

    return Section.objects.alive().filter(class_teacher_staff_id=staff.pk).exists()


def has_direct_reports(*, staff: Staff) -> bool:
    """§11: exit is blocked while other staff still report to this one."""
    return Staff.objects.alive().filter(reports_to_id=staff.pk).exists()


def is_referenced_as_head(*, staff: Staff) -> bool:
    """§11: exit is blocked while this staff heads a campus or department."""
    from apps.school_organization.models import Campus, Department

    return (
        Campus.objects.alive().filter(head_staff_id=staff.pk).exists()
        or Department.objects.alive().filter(head_staff_id=staff.pk).exists()
    )


def is_referenced_as_house_master(*, staff: Staff) -> bool:
    """§11: exit is blocked while this staff is set as a house master."""
    from apps.school_organization.models import House

    return House.objects.alive().filter(house_master_staff_id=staff.pk).exists()


def clearance_blockers(staff: Staff) -> list[str]:
    """Exit clearance checks (§7 exit workflow). Assets/advances/allocation

    clearance always return "clear" because those modules don't exist yet —
    exactly as student_management's withdrawal clearance does.
    """
    blockers = []
    if is_sole_class_teacher(staff=staff):
        blockers.append(
            "This staff member is the class teacher for one or more sections. "
            "Reassign those sections before exiting them."
        )
    if has_direct_reports(staff=staff):
        blockers.append(
            "One or more staff members report to this staff member. Reassign their "
            "reporting line before exiting them."
        )
    if is_referenced_as_head(staff=staff):
        blockers.append(
            "This staff member is set as the head of a campus or department. "
            "Reassign that headship before exiting them."
        )
    if is_referenced_as_house_master(staff=staff):
        blockers.append(
            "This staff member is set as a house master. Reassign that house before exiting them."
        )
    return blockers


@transaction.atomic
def exit_staff(
    *,
    staff: Staff,
    exit_date: date,
    exit_reason: str,
    actor_id: uuid.UUID,
    exit_type: str = EmploymentStatus.RESIGNED,
) -> Staff:
    if staff.employment_status in (
        EmploymentStatus.RESIGNED,
        EmploymentStatus.RETIRED,
        EmploymentStatus.TERMINATED,
    ):
        raise Conflict(f"This staff member has already exited ({staff.employment_status}).")
    if exit_date < staff.joining_date:
        raise DomainRuleViolation({"exit_date": "exit_date must be on or after joining_date."})
    blockers = clearance_blockers(staff)
    if blockers:
        raise DomainRuleViolation({"non_field": " ".join(blockers)})

    staff.employment_status = exit_type
    staff.exit_date = exit_date
    staff.exit_reason = exit_reason
    staff.updated_by = actor_id
    staff.save(
        update_fields=["employment_status", "exit_date", "exit_reason", "updated_by", "updated_at"]
    )
    if staff.user_id is not None:
        # An exited employee must not keep portal access or role assignments —
        # UserRole has no soft-delete field, so it's removed outright rather
        # than deactivated.
        from core.rbac.models import User, UserRole

        User.objects.filter(pk=staff.user_id).update(is_active=False)
        UserRole.objects.filter(user_id=staff.user_id, tenant_id=staff.tenant_id).delete()
    return staff
