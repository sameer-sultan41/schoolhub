"""`clone_session` — copy a session's curriculum forward into a new session (module doc §7.2)."""

from __future__ import annotations

import uuid
from datetime import date

from django.db import transaction

from apps.school_organization.academic_sessions.services.validation import (
    assert_no_session_overlap,
)
from apps.school_organization.models import AcademicSession, ClassSubject, SessionStatus


@transaction.atomic
def clone_session(
    source: AcademicSession,
    *,
    name: str,
    start_date: date,
    end_date: date,
    actor_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> AcademicSession:
    """Create next year's session and copy the curriculum forward (§7.2).

    Classes, sections and subjects are structural and persist across years, so only
    the session-scoped curriculum rows need copying; terms are re-dated by hand
    because term boundaries rarely map one-to-one onto a new calendar.
    """
    assert_no_session_overlap(start_date=start_date, end_date=end_date)

    target = AcademicSession.objects.create(
        tenant_id=tenant_id,
        name=name,
        start_date=start_date,
        end_date=end_date,
        status=SessionStatus.PLANNED,
        is_current=False,
        created_by=actor_id,
        updated_by=actor_id,
    )

    cloned = [
        ClassSubject(
            tenant_id=tenant_id,
            academic_session=target,
            school_class_id=row.school_class_id,
            subject_id=row.subject_id,
            campus_id=row.campus_id,
            is_elective=row.is_elective,
            elective_group=row.elective_group,
            weekly_periods=row.weekly_periods,
            notes=row.notes,
            created_by=actor_id,
            updated_by=actor_id,
        )
        for row in ClassSubject.objects.alive().filter(academic_session=source)
    ]
    if cloned:
        ClassSubject.objects.bulk_create(cloned)

    return target
