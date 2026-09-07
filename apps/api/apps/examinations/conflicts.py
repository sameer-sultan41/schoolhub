"""The exam-scheduling clash engine — §5.2's checks and §11's scheduling rules.

**This is not a refactor of `timetable/conflicts.py`, and that is deliberate.**
The two look alike and share no code, for a reason worth stating once:

- a timetable slot is a *cell in a weekly grid* — `day_of_week` plus
  `period_id` — and takes its start and end from the period it names, so
  clashes there are equality comparisons on a key tuple;
- an exam sitting is a *wall-clock interval on a calendar date*, so a clash is
  an overlap test, and two sittings can conflict without sharing any key.

Every detector in `timetable/conflicts.py` reads `TimetableSlot` attributes, and
its own header records that its duplication with the database constraints is
load-bearing. Bending it to serve two row shapes would put that at risk to save
a file. What transfers is the **pattern**, and this file copies it closely on
purpose so a reader who knows one knows the other:

- a frozen `Conflict` carrying `severity` and *every* schedule involved,
- one `collect_scope()` that fetches everything in a fixed number of queries,
- detectors that are pure functions over that scope with **no query inside any
  of them**,
- hard conflicts blocking publish while soft ones only warn.

The hard/soft split is §5.5's, applied to §11's scheduling list. Hard: a
physical impossibility (one room, one invigilator, one student, two places at
once) or a date outside the exam. Soft: a judgement a school is allowed to
overrule — an over-capacity hall it intends to split, or a sitting during
normal timetabled periods, which is what an exam week *is*.

**Overlap is half-open**: `a.start < b.end and b.start < a.end`. A paper ending
at 10:00 and one starting at 10:00 do not clash. Back-to-back sittings are the
normal shape of an exam day, and the closed reading would report a false
conflict on every one of them.
"""

from __future__ import annotations

import datetime
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Literal

from apps.examinations.models import (
    OCCUPYING_SCHEDULE_STATUSES,
    Exam,
    ExamSchedule,
)

Severity = Literal["hard", "soft"]

ROOM_DOUBLE_BOOKED = "room_double_booked"
INVIGILATOR_DOUBLE_BOOKED = "invigilator_double_booked"
STUDENT_TWO_PAPERS_AT_ONCE = "student_two_papers_at_once"
OUTSIDE_EXAM_WINDOW = "outside_exam_window"
NOT_A_WORKING_DAY = "not_a_working_day"
ROOM_OVER_CAPACITY = "room_over_capacity"
CLASHES_WITH_TIMETABLE = "clashes_with_timetable"

HARD_TYPES = frozenset(
    {
        ROOM_DOUBLE_BOOKED,
        INVIGILATOR_DOUBLE_BOOKED,
        STUDENT_TWO_PAPERS_AT_ONCE,
        OUTSIDE_EXAM_WINDOW,
        NOT_A_WORKING_DAY,
    }
)


@dataclass(frozen=True)
class Conflict:
    """One finding. `schedule_ids` names every sitting involved, not just one.

    §5.2 calls for a clash *list* — a client highlights exactly these rows — so
    a double-booking reports both sides rather than blaming whichever sitting
    was saved second. `slot_ids` in timetable's engine is the same idea under
    the name that module's rows go by.
    """

    type: str
    severity: Severity
    schedule_ids: list[str]
    message: str

    def as_dict(self) -> dict:
        return {
            "type": self.type,
            "severity": self.severity,
            "schedule_ids": self.schedule_ids,
            "message": self.message,
        }


@dataclass
class Scope:
    """Everything the detectors need, fetched once.

    `schedules` is every occupying sitting on any date this exam touches —
    wider than the exam under edit, because a room or invigilator clash is by
    definition with some *other* exam, and an exam week routinely runs two year
    groups side by side.
    """

    exam: Exam | None = None
    schedules: list = field(default_factory=list)
    section_sizes: dict = field(default_factory=dict)
    room_capacity: dict = field(default_factory=dict)
    room_label: dict = field(default_factory=dict)
    section_label: dict = field(default_factory=dict)
    # Campus per section, prefetched. The working-day check needs it and
    # `row.section.campus_id` would be a query per sitting — an N+1 inside a
    # detector, which is exactly what this file's no-query rule exists to stop.
    section_campus: dict = field(default_factory=dict)
    staff_label: dict = field(default_factory=dict)
    section_students: dict = field(default_factory=dict)
    timetabled_weekdays: set = field(default_factory=set)
    # `(exam_date, campus_id) -> (is_working_day, holiday_name)`, from a single
    # `calendar.working_day_map` call. Every *other* calendar function reads
    # `tenant_settings.academic` per call, so asking `is_working_day` per
    # sitting was two queries a row — the N+1 this file's no-query rule exists
    # to stop, and the one CI caught. The batch accessor was added to
    # `school_organization.calendar` rather than re-derived here, so the
    # working-week and holiday rules stay in one place.
    working_day: dict = field(default_factory=dict)


def _overlaps(
    a_start: datetime.time, a_end: datetime.time, b_start: datetime.time, b_end: datetime.time
) -> bool:
    """Half-open interval overlap — see the module docstring."""
    return a_start < b_end and b_start < a_end


def collect_scope(*, exam: Exam) -> Scope:
    """Fetch everything the detectors read, in a fixed number of queries.

    Six queries regardless of how many sittings an exam has. The obvious
    implementation — for each sitting, ask whether its room is free — is one
    round trip per sitting, and an exam week for a whole school is hundreds.
    """
    from apps.school_organization import calendar
    from apps.school_organization.models import Section
    from apps.staff_management.models import Staff
    from apps.student_management.models import EnrollmentStatus, StudentEnrollment
    from apps.timetable.models import Room, SlotStatus, TimetableSlot

    own = list(
        ExamSchedule.objects.alive().filter(exam_subject__exam=exam).select_related("exam_subject")
    )
    dates = {row.exam_date for row in own}

    # Every *other* occupying sitting on the same dates. Excluded by exam rather
    # than by pk so a sitting this exam owns is never compared with itself, and
    # cancelled sittings are excluded entirely — a room freed by a cancellation
    # is free.
    others = (
        list(
            ExamSchedule.objects.alive()
            .filter(exam_date__in=dates, status__in=OCCUPYING_SCHEDULE_STATUSES)
            .exclude(exam_subject__exam=exam)
            .select_related("exam_subject")
        )
        if dates
        else []
    )

    schedules = [row for row in own if row.status in OCCUPYING_SCHEDULE_STATUSES] + others

    section_ids = {row.section_id for row in schedules}
    room_ids = {row.room_id for row in schedules if row.room_id}
    staff_ids = {row.invigilator_staff_id for row in schedules if row.invigilator_staff_id}

    sections = {
        section.pk: section for section in Section.objects.alive().filter(pk__in=section_ids)
    }
    rooms = {room.pk: room for room in Room.objects.alive().filter(pk__in=room_ids)}
    staff = {member.pk: member for member in Staff.objects.alive().filter(pk__in=staff_ids)}

    enrollments = list(
        StudentEnrollment.objects.alive()
        .filter(section_id__in=section_ids, status=EnrollmentStatus.ACTIVE)
        .values_list("section_id", "student_id")
    )
    section_students: dict = defaultdict(set)
    section_sizes: dict = defaultdict(int)
    for section_id, student_id in enrollments:
        section_students[section_id].add(student_id)
        section_sizes[section_id] += 1

    # Which weekdays this exam's own sections have *published* teaching on. A
    # coarse check on purpose: the soft finding is "you have scheduled a paper
    # on a day these sections normally have lessons", which a school either
    # intends (exam week suspends classes) or has overlooked. Comparing against
    # each period's own times would make it a hard-looking finding that is
    # routinely correct to ignore.
    timetabled_weekdays = set(
        TimetableSlot.objects.alive()
        .filter(section_id__in={row.section_id for row in own}, status=SlotStatus.PUBLISHED)
        .values_list("day_of_week", flat=True)
        .distinct()
    )

    # One calendar read for the whole exam, via `calendar.working_day_map`.
    # Scoped to this exam's *own* sittings: a working-day finding is against
    # this exam, not against another that happens to share the day.
    section_campus = {pk: section.campus_id for pk, section in sections.items()}
    working_day = calendar.working_day_map(
        (row.exam_date, section_campus.get(row.section_id)) for row in own
    )

    return Scope(
        exam=exam,
        schedules=schedules,
        section_sizes=dict(section_sizes),
        room_capacity={pk: room.capacity for pk, room in rooms.items()},
        room_label={pk: room.code for pk, room in rooms.items()},
        section_label={pk: section.name for pk, section in sections.items()},
        section_campus=section_campus,
        staff_label={pk: f"{member.first_name} {member.last_name}" for pk, member in staff.items()},
        section_students=dict(section_students),
        timetabled_weekdays=timetabled_weekdays,
        working_day=working_day,
    )


def detect_conflicts(*, exam: Exam) -> list[dict]:
    """Every clash in one exam's schedule, as dicts ready for `meta.conflicts`.

    Returns *all* findings rather than raising on the first, which is the whole
    point of an engine over a per-write check: §8's exam-staff journey is
    "resolves the two room clashes the checker flags", and a checker that
    reported one at a time would make that two round trips.
    """
    scope = collect_scope(exam=exam)
    findings: list[Conflict] = [
        *_room_double_bookings(scope),
        *_invigilator_double_bookings(scope),
        *_student_collisions(scope),
        *_outside_the_exam_window(scope),
        *_non_working_days(scope),
        *_rooms_over_capacity(scope),
        *_timetable_overlaps(scope),
    ]
    return [finding.as_dict() for finding in findings]


def has_hard_conflicts(conflicts: list[dict]) -> bool:
    """True if any finding blocks publishing (§11)."""
    return any(finding["severity"] == "hard" for finding in conflicts)


def _own(scope: Scope) -> list:
    """Only the sittings belonging to the exam under examination.

    Several detectors ask about *this* exam's rows — a date outside its own
    window is not a finding against some other exam that happens to share the
    day — while the double-booking detectors need the wider set.
    """
    if scope.exam is None:
        return []
    return [row for row in scope.schedules if row.exam_subject.exam_id == scope.exam.pk]


def _pairs_by_key(schedules: list, key) -> list[tuple]:
    """Overlapping pairs within each group, computed in memory.

    Grouped first so the comparison is quadratic in a room's own day rather
    than in the whole exam week — a room holds a handful of sittings a day, and
    the grouping is what keeps this from being quadratic in the hundreds.
    """
    grouped: dict = defaultdict(list)
    for row in schedules:
        group = key(row)
        if group is not None:
            grouped[group].append(row)

    pairs = []
    for rows in grouped.values():
        ordered = sorted(rows, key=lambda row: row.start_time)
        for index, earlier in enumerate(ordered):
            for later in ordered[index + 1 :]:
                if not _overlaps(
                    earlier.start_time, earlier.end_time, later.start_time, later.end_time
                ):
                    # Sorted by start, so once one candidate starts at or after
                    # this row's end, every later one does too.
                    break
                pairs.append((earlier, later))
    return pairs


def _room_double_bookings(scope: Scope) -> list[Conflict]:
    """§11 — a room is single-booked. Hard: two cohorts cannot share a hall."""
    findings = []
    for earlier, later in _pairs_by_key(scope.schedules, lambda row: (row.room_id, row.exam_date)):
        room = scope.room_label.get(earlier.room_id, "this room")
        findings.append(
            Conflict(
                type=ROOM_DOUBLE_BOOKED,
                severity="hard",
                schedule_ids=[str(earlier.pk), str(later.pk)],
                message=(
                    f"Room {room} is booked twice on {earlier.exam_date}: "
                    f"{earlier.start_time:%H:%M}-{earlier.end_time:%H:%M} and "
                    f"{later.start_time:%H:%M}-{later.end_time:%H:%M}."
                ),
            )
        )
    return findings


def _invigilator_double_bookings(scope: Scope) -> list[Conflict]:
    """§11 — an invigilator is single-booked. Hard: they can only be in one hall."""
    findings = []
    for earlier, later in _pairs_by_key(
        scope.schedules, lambda row: (row.invigilator_staff_id, row.exam_date)
    ):
        who = scope.staff_label.get(earlier.invigilator_staff_id, "This invigilator")
        findings.append(
            Conflict(
                type=INVIGILATOR_DOUBLE_BOOKED,
                severity="hard",
                schedule_ids=[str(earlier.pk), str(later.pk)],
                message=(
                    f"{who} is invigilating two sittings at once on {earlier.exam_date}: "
                    f"{earlier.start_time:%H:%M}-{earlier.end_time:%H:%M} and "
                    f"{later.start_time:%H:%M}-{later.end_time:%H:%M}."
                ),
            )
        )
    return findings


def _student_collisions(scope: Scope) -> list[Conflict]:
    """§11 — "no student may have two papers at overlapping times". Hard.

    Compared through the sections' *rosters* rather than by section identity: a
    student enrolled in one section can still collide with a sitting scheduled
    for another (an elective cohort, a resit group), and comparing section ids
    would miss exactly that case while appearing to check it.
    """
    findings = []
    for earlier, later in _pairs_by_key(scope.schedules, lambda row: row.exam_date):
        if earlier.section_id == later.section_id:
            # The same section sitting two overlapping papers is the same
            # collision, reported once with a clearer message below.
            shared = scope.section_students.get(earlier.section_id, set())
        else:
            shared = scope.section_students.get(
                earlier.section_id, set()
            ) & scope.section_students.get(later.section_id, set())
        if not shared:
            continue
        where = (
            scope.section_label.get(earlier.section_id, "a section")
            if earlier.section_id == later.section_id
            else (
                f"{scope.section_label.get(earlier.section_id, 'a section')} and "
                f"{scope.section_label.get(later.section_id, 'another section')}"
            )
        )
        findings.append(
            Conflict(
                type=STUDENT_TWO_PAPERS_AT_ONCE,
                severity="hard",
                schedule_ids=[str(earlier.pk), str(later.pk)],
                message=(
                    f"{len(shared)} student(s) in {where} would sit two papers at once on "
                    f"{earlier.exam_date} "
                    f"({earlier.start_time:%H:%M}-{earlier.end_time:%H:%M} overlaps "
                    f"{later.start_time:%H:%M}-{later.end_time:%H:%M})."
                ),
            )
        )
    return findings


def _outside_the_exam_window(scope: Scope) -> list[Conflict]:
    """§11 — "exam dates within the session/term". Hard.

    Checked against the exam's own `starts_on`/`ends_on`, which
    `services.assert_exam_dates_in_range` has already confined to the session or
    term. A dateless exam has no window to be outside of.
    """
    exam = scope.exam
    if exam is None or exam.starts_on is None:
        return []
    findings = []
    for row in _own(scope):
        if row.exam_date < exam.starts_on or row.exam_date > exam.ends_on:
            findings.append(
                Conflict(
                    type=OUTSIDE_EXAM_WINDOW,
                    severity="hard",
                    schedule_ids=[str(row.pk)],
                    message=(
                        f"This sitting is on {row.exam_date}, outside the exam's own dates "
                        f"({exam.starts_on} to {exam.ends_on})."
                    ),
                )
            )
    return findings


def _non_working_days(scope: Scope) -> list[Conflict]:
    """Hard — a paper scheduled on a closure is a paper nobody sits.

    Uses `school_organization.calendar`, the same working-week and holiday
    configuration `attendance` refuses to mark against. Hard rather than soft
    because the alternative is a hall of students arriving at a locked school:
    a school that genuinely opens for an exam adds the day to its working week
    or removes the holiday, which is a real edit rather than an override.

    Reads `scope.working_day`, precomputed per distinct (date, campus) pair —
    see that field's comment for why calling the calendar here would be an N+1.
    """
    findings = []
    for row in _own(scope):
        campus_id = scope.section_campus.get(row.section_id)
        is_working, name = scope.working_day.get((row.exam_date, campus_id), (True, None))
        if is_working:
            continue
        reason = f"a holiday ({name})" if name else "not a working day"
        findings.append(
            Conflict(
                type=NOT_A_WORKING_DAY,
                severity="hard",
                schedule_ids=[str(row.pk)],
                message=f"{row.exam_date} is {reason} for this school.",
            )
        )
    return findings


def _rooms_over_capacity(scope: Scope) -> list[Conflict]:
    """Soft — §5.2 flags it; a school may intend to split the cohort.

    A room with no recorded capacity is not a finding: an unknown capacity is
    not a small one, and guessing would make the whole list noise.
    """
    findings = []
    for row in _own(scope):
        capacity = scope.room_capacity.get(row.room_id)
        size = scope.section_sizes.get(row.section_id, 0)
        if capacity is None or size <= capacity:
            continue
        findings.append(
            Conflict(
                type=ROOM_OVER_CAPACITY,
                severity="soft",
                schedule_ids=[str(row.pk)],
                message=(
                    f"Room {scope.room_label.get(row.room_id, '')} seats {capacity} but "
                    f"{size} students are scheduled into it."
                ),
            )
        )
    return findings


def _timetable_overlaps(scope: Scope) -> list[Conflict]:
    """Soft — §17's clash check against regular periods.

    Soft, and firmly so: an exam week *is* a week that displaces normal
    lessons, so a school scheduling a paper into teaching time is usually doing
    exactly what it means to. The finding exists so a paper accidentally
    dropped into a normal teaching week is visible, not to block one.
    """
    findings = []
    for row in _own(scope):
        if row.exam_date.weekday() not in scope.timetabled_weekdays:
            continue
        findings.append(
            Conflict(
                type=CLASHES_WITH_TIMETABLE,
                severity="soft",
                schedule_ids=[str(row.pk)],
                message=(
                    f"{scope.section_label.get(row.section_id, 'This section')} has published "
                    f"lessons on {row.exam_date:%A}s. Confirm classes are suspended."
                ),
            )
        )
    return findings
