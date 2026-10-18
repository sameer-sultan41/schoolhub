"""The rows a primary teacher's succession touches: who holds a slot, and when one ends (§6).

Split out of `services.py`, which holds the rules that call them (create, PATCH, reassignment).
"""

from __future__ import annotations

import uuid
from datetime import date

from django.utils import timezone

from apps.academics.models import TeacherSubjectAllocation
from apps.school_organization.models import AcademicSession, Section, Subject
from apps.staff_management.models import Staff


def row_for_slot(
    *,
    session: AcademicSession,
    section: Section,
    subject: Subject,
    staff: Staff,
    exclude_pk: uuid.UUID | None = None,
) -> TeacherSubjectAllocation | None:
    """The teacher's own row for this slot, in any state: `tsa_unique_allocation` allows one."""
    rows = TeacherSubjectAllocation.objects.alive().filter(
        academic_session=session, section=section, subject=subject, staff=staff
    )
    if exclude_pk is not None:
        rows = rows.exclude(pk=exclude_pk)
    return rows.first()


def outgoing_end_date(effective_from: date | None) -> date:
    """The end date `end_date_current_primary` gives a primary that starts on `effective_from`."""
    today = timezone.localdate()
    return max(effective_from or today, today)


def end_date_current_primary(
    *,
    session: AcademicSession,
    section: Section,
    subject: Subject,
    actor_id: uuid.UUID,
    exclude_pk: uuid.UUID | None = None,
) -> None:
    """End-date the outgoing primary rather than deleting it (§6).

    "Reassignment mid-session preserves history (old allocation end-dated, not
    deleted)" — and it is also what keeps `tsa_one_primary_per_section_subject`
    satisfiable, since that constraint only counts allocations with no
    `effective_to`. Shared by create and PATCH; `exclude_pk` is the row being edited.
    """
    outgoing = TeacherSubjectAllocation.objects.alive().filter(
        academic_session=session,
        section=section,
        subject=subject,
        is_primary=True,
        effective_to__isnull=True,
    )
    if exclude_pk is not None:
        outgoing = outgoing.exclude(pk=exclude_pk)
    # A primary lined up to start later is ended at its own start: ending it
    # "today" would put effective_to before effective_from (tsa_effective_range_ordered).
    for row in outgoing.select_for_update():
        row.effective_to = outgoing_end_date(row.effective_from)
        row.updated_by = actor_id
        row.save(update_fields=["effective_to", "updated_by", "updated_at"])
