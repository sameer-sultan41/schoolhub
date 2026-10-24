"""The register: who may mark a section on a date, its roster, and the caller's own registers.

**One predicate, ``may_mark_register``**, answers "may this user mark this
section's register for this date (and period)". The register read, `my-registers`
and `:bulk-mark` all ask it, so the screen a teacher is shown and the submission
the server accepts cannot disagree about who marks.

Period mode (ADR-0028) widens §11's markers: the teacher who holds the
section's lesson in that period on that date — a confirmed substitute
*replacing* the absent teacher — besides the class teacher and `all`/`campus`
scope. "Who holds it that date" is always the version-aware, cover-aware
timetable (`services.effective_lessons`), never today's grid.
"""

from __future__ import annotations

import datetime
import uuid
from typing import TYPE_CHECKING

from django.db.models import Q

from apps.attendance import services
from apps.attendance.models import AttendanceStatus, StudentAttendance
from apps.school_organization.models import Section
from apps.school_organization.services import LOCKED_SESSION_STATES
from apps.staff_management.models import EmploymentStatus, Staff
from apps.student_management.models import EnrollmentStatus, StudentEnrollment
from apps.timetable.slots.services import teacher_slots_for
from core.rbac.models import RecordScope
from core.rbac.permissions import user_scopes

if TYPE_CHECKING:
    from apps.school_organization.models import AcademicSession
    from apps.timetable.models import Period


def caller_staff_ids(user) -> set[uuid.UUID]:
    """The caller's own active `Staff` rows, whatever their record scope."""
    return set(
        Staff.objects.alive()
        .filter(user_id=user.pk, employment_status=EmploymentStatus.ACTIVE)
        .values_list("pk", flat=True)
    )


def may_mark_register(
    *,
    user,
    section: Section,
    on_date: datetime.date,
    period: Period | None,
    lessons: dict | None = None,
) -> bool:
    """§11 as amended by ADR-0028 — who may mark this section's register.

    1. `all` scope; `campus` scope on the section's campus;
    2. with `assigned` scope, the section's class teacher;
    3. with `assigned` scope and a `period`, the teacher of the section's lesson
       in that period on `on_date`. A confirmed substitute replaces the absent
       teacher, who may not mark it.

    `own` alone marks nothing, since a student marking their own register is not
    a workflow §5 describes. Whether a period fits the mode is the service's
    gate (``services.assert_register_period``), not this predicate's.

    `lessons` is ``services.effective_lessons`` for this section and date, when
    the caller has already read it in the request's session; otherwise the
    session is the one containing the date.
    """
    grant = _scope_grant(user_scopes(user), section)
    if grant is not None:
        return grant
    staff_ids = caller_staff_ids(user)
    if section.class_teacher_staff_id in staff_ids:
        return True
    if period is None:
        return False
    if lessons is None:
        session = services.session_for_date(on_date)
        if session is None:
            return False
        lessons = services.effective_lessons(
            session=session, section_ids=[section.pk], on_date=on_date
        )
    lesson = lessons.get((section.pk, period.pk))
    return lesson is not None and lesson.teacher_id in staff_ids


def _scope_grant(scopes: dict, section: Section) -> bool | None:
    """True or False when record scope alone decides; None when the assignment rules do."""
    if RecordScope.ALL in scopes:
        return True
    if section.campus_id in {ref for ref in scopes.get(RecordScope.CAMPUS, []) if ref}:
        return True
    if RecordScope.ASSIGNED not in scopes:
        return False
    return None


def register_for(
    *,
    section: Section,
    session: AcademicSession,
    on_date: datetime.date,
    period: Period | None,
) -> list[dict]:
    """One row per rostered student, in `roster_enrollments` order, with the date's record merged.

    Records are matched on (student, date, period), not on section — the key the
    unique indexes and ``bulk_mark_student_attendance`` use — so a student moved
    into this section today still shows the mark they already have. `on_leave`
    reads the daily row, which is what approved leave writes in either mode.
    """
    enrollments = services.roster_enrollments(section=section, session=session)
    rows = (
        StudentAttendance.objects.alive()
        .filter(
            Q(period=period) | Q(period__isnull=True, status=AttendanceStatus.ON_LEAVE),
            student_id__in=[enrollment.student_id for enrollment in enrollments],
            attendance_date=on_date,
        )
        .select_related("student", "section", "academic_session", "period")
    )
    period_id = period.pk if period is not None else None
    records: dict[uuid.UUID, StudentAttendance] = {}
    on_leave: set[uuid.UUID] = set()
    for row in rows:
        if row.period_id == period_id:
            records[row.student_id] = row
        if row.period_id is None and row.status == AttendanceStatus.ON_LEAVE:
            on_leave.add(row.student_id)

    return [
        {
            "student": enrollment.student,
            "roll_number": enrollment.roll_number,
            "record": records.get(enrollment.student_id),
            "on_leave": enrollment.student_id in on_leave,
        }
        for enrollment in enrollments
    ]


def register_meta(*, section: Section, session: AcademicSession, on_date: datetime.date) -> dict:
    """`meta` for the register: the mode, the lock, and why it is read-only if it is.

    `markable` is about the *date* only: false where `assert_markable_date` or a
    closed session would refuse every row, so the screen renders read-only
    rather than failing on submit. The lock is per row (`record.is_locked`);
    `is_locked` here says only that the date is past the window.
    """
    issue = services.unmarkable_date_issue(on_date=on_date, campus_id=section.campus_id)
    closed = services.UNMARKABLE_SESSION_CLOSED if session.status in LOCKED_SESSION_STATES else None
    reason = issue.reason if issue is not None else closed
    return {
        "attendance_mode": services.attendance_mode(),
        "is_locked": services.is_locked(on_date),
        "markable": reason is None,
        "unmarkable_reason": reason,
        "holiday_name": issue.holiday_name if issue is not None else None,
    }


def my_registers(*, user, session: AcademicSession, on_date: datetime.date) -> list[dict]:
    """The registers the caller marks on `on_date`, resolved from their own `Staff` rows.

    From the caller's staff rows whatever their scope, so an `all`-scoped class
    teacher gets their own sections rather than an empty list or every section.

    - Daily mode: the sections they class-teach.
    - Period mode: the lessons they teach that day (``teacher_slots_for``, less
      any a confirmed substitute took from them), plus every lesson that day of
      the sections they class-teach. One entry per (section, period).

    Each entry satisfies an assignment rule of ``may_mark_register`` by
    construction, and record scope is applied the same way, so `:bulk-mark`'s
    marker and scope check accepts every entry. Its date and session checks are
    not applied here: a future date, a holiday or a date outside every session
    can still list entries.

    A bounded number of queries whatever the number of sections or lessons, plus
    the scope lookup, which is cached per user.
    """
    staff_ids = caller_staff_ids(user)
    if not staff_ids:
        return []
    class_taught = list(
        Section.objects.alive()
        .filter(class_teacher_staff_id__in=staff_ids, is_active=True)
        .select_related("school_class")
    )
    registers: list[tuple[Section, Period | None]]
    if services.attendance_mode() == services.ATTENDANCE_MODE_PERIOD:
        registers = list(
            _lessons_marked_by(
                staff_ids=staff_ids, class_taught=class_taught, session=session, on_date=on_date
            )
        )
    else:
        registers = [(section, None) for section in class_taught]

    scopes = user_scopes(user)
    registers = [
        (section, period)
        for section, period in registers
        if _scope_grant(scopes, section) is not False
    ]
    if not registers:
        return []

    roster = list(
        StudentEnrollment.objects.alive()
        .filter(
            section__in={section.pk for section, _ in registers},
            academic_session=session,
            status=EnrollmentStatus.ACTIVE,
            student__deleted_at__isnull=True,
        )
        .values_list("section_id", "student_id")
    )
    period_ids = {period.pk for _, period in registers if period is not None}
    marked = set(
        StudentAttendance.objects.alive()
        .filter(
            Q(period_id__in=period_ids) if period_ids else Q(period__isnull=True),
            attendance_date=on_date,
            student_id__in=[student_id for _, student_id in roster],
        )
        .values_list("student_id", "period_id")
    )
    students_of: dict[uuid.UUID, list[uuid.UUID]] = {}
    for section_id, student_id in roster:
        students_of.setdefault(section_id, []).append(student_id)

    entries = []
    for section, period in registers:
        students = students_of.get(section.pk, [])
        period_id = period.pk if period is not None else None
        entries.append(
            {
                "section_id": section.pk,
                "section_name": section.name,
                "class_name": section.school_class.name,
                "campus_id": section.campus_id,
                "period_id": period_id,
                "period_name": period.name if period is not None else None,
                "start_time": period.start_time if period is not None else None,
                "end_time": period.end_time if period is not None else None,
                "marked_count": sum(1 for s in students if (s, period_id) in marked),
                "roster_count": len(students),
            }
        )
    # By start time (daily registers have none), then section name, then class.
    entries.sort(
        key=lambda entry: (
            entry["start_time"] is None,
            entry["start_time"] or datetime.time.min,
            entry["section_name"],
            entry["class_name"],
        )
    )
    return entries


def _lessons_marked_by(
    *,
    staff_ids: set[uuid.UUID],
    class_taught: list[Section],
    session: AcademicSession,
    on_date: datetime.date,
) -> list[tuple[Section, Period]]:
    """Period mode's registers for these staff on `on_date`, one per (section, period).

    Their own lessons that day, where cover has not handed the lesson to someone
    else (``teacher_slots_for`` keeps a covered cell in the absent teacher's
    list, with its override), plus every lesson of the sections they class-teach.
    Sections are re-read alive and active, with their class, in one query.
    """
    taught = services.lesson_cells(
        *teacher_slots_for(staff_ids=staff_ids, session=session, on_date=on_date),
        on_date=on_date,
    )
    cells = {key: cell for key, cell in taught.items() if cell.teacher_id in staff_ids}
    if class_taught:
        cells.update(
            services.effective_lessons(
                session=session,
                section_ids=[section.pk for section in class_taught],
                on_date=on_date,
            )
        )
    if not cells:
        return []
    sections = {
        section.pk: section
        for section in Section.objects.alive()
        .filter(pk__in={section_id for section_id, _ in cells}, is_active=True)
        .select_related("school_class")
    }
    return [
        (sections[section_id], cell.slot.period)
        for (section_id, _), cell in cells.items()
        if section_id in sections
    ]
