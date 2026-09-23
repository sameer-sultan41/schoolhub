"""Business rules for the StudentTransfer resource — inter-section/inter-campus
transfer requests and their approve/reject/complete decisions.

Transfer-exclusive rules split out of the app-root ``services.py`` — see
docs/03-modules/student-management.md §20's file-per-action package layout.
Shared helpers (``active_enrollment``, ``assert_student_active``,
``assert_section_belongs_to_class``, ``_assert_capacity``) stay in the app
root — also used by the sibling ``students`` package — and are imported from
there.
"""

from __future__ import annotations

import uuid
from datetime import date

from django.db import transaction
from django.utils import timezone

from apps.school_organization.models import Section
from apps.student_management.models import (
    EnrollmentStatus,
    Student,
    StudentStatus,
    StudentTransfer,
    TransferStatus,
    TransferType,
)
from apps.student_management.services import (
    _assert_capacity,
    active_enrollment,
    assert_section_belongs_to_class,
    assert_student_active,
)
from core.api.exceptions import Conflict, DomainRuleViolation


def assert_transfer_campus_fields(
    *,
    transfer_type: str,
    from_campus,
    to_campus,
    external_school_name: str | None,
) -> None:
    """Per-type nullability, service-enforced rather than a check constraint

    (plan deviation E) — a 422 naming the field beats an opaque IntegrityError.
    """
    if transfer_type == TransferType.INTER_CAMPUS:
        if from_campus is None or to_campus is None:
            raise DomainRuleViolation(
                {
                    "non_field": (
                        "Inter-campus transfers require both from_campus_id and to_campus_id."
                    )
                }
            )
        if external_school_name:
            raise DomainRuleViolation(
                {"external_school_name": "Not applicable to an inter-campus transfer."}
            )
    elif transfer_type == TransferType.OUTGOING:
        if from_campus is None:
            raise DomainRuleViolation({"from_campus_id": "Required for an outgoing transfer."})
        if to_campus is not None:
            raise DomainRuleViolation({"to_campus_id": "Not applicable to an outgoing transfer."})
        if not external_school_name:
            raise DomainRuleViolation(
                {"external_school_name": "Required for an outgoing transfer."}
            )
    elif transfer_type == TransferType.INCOMING:
        if to_campus is None:
            raise DomainRuleViolation({"to_campus_id": "Required for an incoming transfer."})
        if from_campus is not None:
            raise DomainRuleViolation({"from_campus_id": "Not applicable to an incoming transfer."})
        if not external_school_name:
            raise DomainRuleViolation(
                {"external_school_name": "Required for an incoming transfer."}
            )


@transaction.atomic
def request_transfer(
    *,
    student: Student,
    transfer_type: str,
    reason: str,
    effective_date: date,
    from_campus=None,
    to_campus=None,
    external_school_name: str | None = None,
    actor_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> StudentTransfer:
    assert_student_active(student)
    assert_transfer_campus_fields(
        transfer_type=transfer_type,
        from_campus=from_campus,
        to_campus=to_campus,
        external_school_name=external_school_name,
    )
    return StudentTransfer.objects.create(
        tenant_id=tenant_id,
        student=student,
        transfer_type=transfer_type,
        from_campus=from_campus,
        to_campus=to_campus,
        external_school_name=external_school_name,
        reason=reason,
        effective_date=effective_date,
        created_by=actor_id,
        updated_by=actor_id,
    )


def assert_transfer_decidable(*, transfer: StudentTransfer, actor_id: uuid.UUID) -> None:
    if transfer.status != TransferStatus.REQUESTED:
        raise Conflict(f"Transfer is already {transfer.status}.")
    if transfer.created_by == actor_id:
        raise DomainRuleViolation(
            {"non_field": "The initiator of a transfer may not also approve or reject it."}
        )


@transaction.atomic
def approve_transfer(*, transfer: StudentTransfer, actor_id: uuid.UUID) -> StudentTransfer:
    assert_transfer_decidable(transfer=transfer, actor_id=actor_id)
    assert_student_active(transfer.student)
    transfer.status = TransferStatus.APPROVED
    transfer.decided_by = actor_id
    transfer.decided_at = timezone.now()
    transfer.updated_by = actor_id
    transfer.save(update_fields=["status", "decided_by", "decided_at", "updated_by", "updated_at"])
    return transfer


@transaction.atomic
def reject_transfer(*, transfer: StudentTransfer, actor_id: uuid.UUID) -> StudentTransfer:
    assert_transfer_decidable(transfer=transfer, actor_id=actor_id)
    transfer.status = TransferStatus.REJECTED
    transfer.decided_by = actor_id
    transfer.decided_at = timezone.now()
    transfer.updated_by = actor_id
    transfer.save(update_fields=["status", "decided_by", "decided_at", "updated_by", "updated_at"])
    return transfer


@transaction.atomic
def complete_transfer(
    *,
    transfer: StudentTransfer,
    actor_id: uuid.UUID,
    section: Section | None = None,
) -> StudentTransfer:
    """Execute an approved transfer (module doc §6-§7.2).

    Inter-campus: reallocates the student's current enrollment to `section`
    (which must belong to `to_campus`) and moves `student.campus`. Outgoing:
    ends the active enrollment and sets the student's status to
    `transferred`. Incoming has no defined workflow yet (plan drift #2) — this
    is a status-only no-op for that type, documented rather than silently
    guessed at.
    """
    if transfer.status != TransferStatus.APPROVED:
        raise Conflict(
            f"Transfer must be approved before it can be completed (currently {transfer.status})."
        )

    student = transfer.student
    # Re-check now, not just at request/approve time: the student's status can have
    # changed in the (possibly long) gap between approval and completion — e.g.
    # withdrawn via a separate action — and completing here would otherwise silently
    # reset that status back to `transferred`, undoing the withdrawal.
    assert_student_active(student)
    if transfer.transfer_type == TransferType.INTER_CAMPUS:
        if section is None:
            raise DomainRuleViolation(
                {
                    "section_id": (
                        "A destination section is required to complete an inter-campus transfer."
                    )
                }
            )
        if section.campus_id != transfer.to_campus_id:
            raise DomainRuleViolation(
                {"section_id": "Section does not belong to the destination campus."}
            )
        # assert_transfer_campus_fields guarantees to_campus is set for every
        # inter-campus transfer at creation time; this is the type checker's
        # window into that runtime invariant.
        assert transfer.to_campus is not None
        enrollment = active_enrollment(student)
        if enrollment is not None:
            assert_section_belongs_to_class(section=section, school_class=enrollment.school_class)
            _assert_capacity(
                section=section,
                exclude_enrollment_id=enrollment.pk,
                capacity_override_reason=None,
                actor_has_capacity_override=False,
            )
            enrollment.section = section
            enrollment.updated_by = actor_id
            enrollment.save(update_fields=["section", "updated_by", "updated_at"])
        student.campus = transfer.to_campus
        student.updated_by = actor_id
        student.save(update_fields=["campus", "updated_by", "updated_at"])
    elif transfer.transfer_type == TransferType.OUTGOING:
        enrollment = active_enrollment(student)
        if enrollment is not None:
            enrollment.status = EnrollmentStatus.TRANSFERRED_OUT
            enrollment.end_date = transfer.effective_date
            enrollment.updated_by = actor_id
            enrollment.save(update_fields=["status", "end_date", "updated_by", "updated_at"])
        student.status = StudentStatus.TRANSFERRED
        student.updated_by = actor_id
        student.save(update_fields=["status", "updated_by", "updated_at"])
    # incoming: no automated side effect — see the docstring.

    transfer.status = TransferStatus.COMPLETED
    transfer.updated_by = actor_id
    transfer.save(update_fields=["status", "updated_by", "updated_at"])
    return transfer
