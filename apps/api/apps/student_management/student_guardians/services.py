"""Business rules for the StudentGuardian *link* — the relationship row
connecting a guardian to a student, not the standalone ``Guardian`` record
(that lives in the sibling ``guardians`` package's own ``services.py``).

Link-exclusive rules split out of the app-root ``services.py`` — see
docs/03-modules/student-management.md §20's file-per-action package layout.
"""

from __future__ import annotations

import uuid

from django.db import transaction

from apps.student_management.models import Guardian, Student, StudentGuardian


@transaction.atomic
def link_guardian(
    *,
    student: Student,
    guardian: Guardian,
    relationship: str,
    is_primary: bool = False,
    is_fee_responsible: bool = False,
    can_pick_up: bool = True,
    receives_communications: bool = True,
    has_portal_access: bool = True,
    actor_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> StudentGuardian:
    """Link a guardian to a student. Demotes any incumbent primary first — see

    set_primary_guardian's docstring for why that ordering is load-bearing.
    """
    if is_primary:
        _demote_primary_guardian(student=student, actor_id=actor_id)

    return StudentGuardian.objects.create(
        tenant_id=tenant_id,
        student=student,
        guardian=guardian,
        relationship=relationship,
        is_primary=is_primary,
        is_fee_responsible=is_fee_responsible,
        can_pick_up=can_pick_up,
        receives_communications=receives_communications,
        has_portal_access=has_portal_access,
        created_by=actor_id,
        updated_by=actor_id,
    )


def _demote_primary_guardian(*, student: Student, actor_id: uuid.UUID) -> None:
    StudentGuardian.objects.alive().filter(student=student, is_primary=True).update(
        is_primary=False, updated_by=actor_id
    )


@transaction.atomic
def set_primary_guardian(
    *, student: Student, link: StudentGuardian, actor_id: uuid.UUID
) -> StudentGuardian:
    """Promote `link` to primary, demoting the incumbent first.

    Must demote before promoting: the partial unique index
    (`student_guardians_one_primary_per_student`) is checked per statement, so
    writing two primaries and fixing it up afterwards raises instead of
    succeeding — the same trap school_organization's `clear_primary_campus`
    documents.
    """
    _demote_primary_guardian(student=student, actor_id=actor_id)
    link.is_primary = True
    link.updated_by = actor_id
    link.save(update_fields=["is_primary", "updated_by", "updated_at"])
    return link
