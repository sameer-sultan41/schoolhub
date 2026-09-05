"""The conflict engine.

timetable.md §5.5 splits conflicts into two kinds and the distinction is the
whole design: **hard** conflicts block publish (§11), **soft** ones only warn,
because a grid mid-build is allowed to be imperfect and an admin who cannot save
an in-progress state cannot build a timetable at all.

§6 names three callers, and they must agree, so they share one function:

- a per-edit check (fast, single-slot scope) that still saves and returns
  `meta.conflicts`,
- `:validate`, a full run over a section,
- `:publish`, which refuses on any hard conflict.

**Everything is computed over pre-fetched rows, never per slot.** A section's
week is roughly forty cells and the grid renders all of them at once, so the
obvious "for each slot, query for a clash" shape would be forty round trips per
render. `collect_scope()` does the fetching — three queries regardless of size —
and the detectors below are pure functions over what it returned.

The three hard clash types are *also* database constraints on published rows
(models.py). That is deliberate duplication: this engine gives a caller a list of
everything wrong at once, which a constraint violation cannot, while the
constraint is what holds when two admins race.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Literal

Severity = Literal["hard", "soft"]

# §5.5: "thresholds tenant-configurable". These are the defaults until
# TenantSettings grows a timetable namespace; both are read through
# `Thresholds` so the call sites do not hardcode them.
DEFAULT_MAX_CONSECUTIVE_PERIODS = 3
DEFAULT_MAX_SUBJECT_PER_DAY = 1


@dataclass(frozen=True)
class Thresholds:
    max_consecutive_periods: int = DEFAULT_MAX_CONSECUTIVE_PERIODS
    max_subject_occurrences_per_day: int = DEFAULT_MAX_SUBJECT_PER_DAY


@dataclass(frozen=True)
class Conflict:
    """One finding. `slot_ids` names every slot involved, not just the newest.

    §6 calls for a machine-readable list — a client highlights exactly these
    cells, so a clash reports both sides rather than blaming whichever row was
    saved second.
    """

    type: str
    severity: Severity
    slot_ids: list[str]
    message: str

    def as_dict(self) -> dict:
        return {
            "type": self.type,
            "severity": self.severity,
            "slot_ids": self.slot_ids,
            "message": self.message,
        }


@dataclass
class Scope:
    """Everything the detectors need, fetched once.

    `slots` is every *candidate* row for the session — that has to be wider than
    the section under edit, because a teacher or room clash is by definition with
    some other section.
    """

    slots: list = field(default_factory=list)
    allocations: set[tuple] = field(default_factory=set)
    section_sizes: dict = field(default_factory=dict)
    break_period_ids: set = field(default_factory=set)
    period_campus: dict = field(default_factory=dict)
    period_weekdays: dict = field(default_factory=dict)
    section_campus: dict = field(default_factory=dict)
    room_capacity: dict = field(default_factory=dict)


def collect_scope(*, session, section=None) -> Scope:
    """Fetch the whole comparison set in a fixed number of queries.

    `section` narrows only the *reporting*, never the comparison: a slot can only
    clash with rows outside its own section, so the fetch stays session-wide.
    """
    from apps.academics.models import TeacherSubjectAllocation
    from apps.school_organization.models import Section
    from apps.student_management.models import EnrollmentStatus, StudentEnrollment
    from apps.timetable.models import Period, Room, TimetableSlot

    slots = list(
        TimetableSlot.objects.alive()
        .filter(academic_session=session, effective_to__isnull=True)
        .select_related("period")
    )

    allocations = set(
        TeacherSubjectAllocation.objects.alive()
        .filter(academic_session=session, effective_to__isnull=True)
        .values_list("section_id", "subject_id", "staff_id")
    )

    sections = {
        row["id"]: row["campus_id"] for row in Section.objects.alive().values("id", "campus_id")
    }

    periods = {
        row["id"]: (row["is_break"], row["campus_id"], row["weekdays"])
        for row in Period.objects.alive().values("id", "is_break", "campus_id", "weekdays")
    }

    sizes: dict = defaultdict(int)
    for section_id in (
        StudentEnrollment.objects.alive()
        .filter(academic_session=session, status=EnrollmentStatus.ACTIVE)
        .values_list("section_id", flat=True)
    ):
        sizes[section_id] += 1

    return Scope(
        slots=slots,
        allocations=allocations,
        section_sizes=dict(sizes),
        break_period_ids={pk for pk, (is_break, _, _) in periods.items() if is_break},
        period_campus={pk: campus for pk, (_, campus, _) in periods.items()},
        period_weekdays={pk: weekdays for pk, (_, _, weekdays) in periods.items()},
        section_campus=sections,
        room_capacity={
            row["id"]: row["capacity"] for row in Room.objects.alive().values("id", "capacity")
        },
    )


def detect_conflicts(*, session, section=None, thresholds: Thresholds | None = None) -> list[dict]:
    """Every conflict in `session`, optionally reported only for `section`."""
    scope = collect_scope(session=session, section=section)
    limits = thresholds or Thresholds()

    findings: list[Conflict] = []
    findings.extend(_double_bookings(scope))
    findings.extend(_unallocated_teachers(scope))
    findings.extend(_break_and_campus_mismatches(scope))
    findings.extend(_room_over_capacity(scope))
    findings.extend(_subject_repeated_in_a_day(scope, limits))
    findings.extend(_consecutive_load(scope, limits))

    if section is not None:
        section_id = getattr(section, "pk", section)
        wanted = {str(slot.pk) for slot in scope.slots if slot.section_id == section_id}
        findings = [f for f in findings if wanted.intersection(f.slot_ids)]

    # Hard first: a client showing the top few must not lead with a warning
    # while a blocking clash sits below the fold.
    findings.sort(key=lambda f: (f.severity != "hard", f.type))
    return [f.as_dict() for f in findings]


def has_hard_conflicts(conflicts: list[dict]) -> bool:
    return any(conflict["severity"] == "hard" for conflict in conflicts)


# ---------------------------------------------------------------------------
# Detectors — pure functions over a Scope, no queries
# ---------------------------------------------------------------------------


def _double_bookings(scope: Scope) -> list[Conflict]:
    """Section, teacher and room clashes — the three hard types.

    Drafts count. A draft double-booking is exactly what `:validate` exists to
    surface before publish refuses it.
    """
    by_section: dict = defaultdict(list)
    by_teacher: dict = defaultdict(list)
    by_room: dict = defaultdict(list)

    for slot in scope.slots:
        cell = (slot.day_of_week, slot.period_id)
        by_section[(slot.section_id, *cell)].append(slot)
        if slot.staff_id:
            by_teacher[(slot.staff_id, *cell)].append(slot)
        if slot.room_id:
            by_room[(slot.room_id, *cell)].append(slot)

    out: list[Conflict] = []
    for kind, grouped, message in (
        ("section_double_booked", by_section, "This section already has a class in this period."),
        ("teacher_double_booked", by_teacher, "This teacher is already teaching in this period."),
        ("room_double_booked", by_room, "This room is already in use in this period."),
    ):
        for slots in grouped.values():
            if len(slots) > 1:
                out.append(
                    Conflict(
                        type=kind,
                        severity="hard",
                        slot_ids=sorted(str(s.pk) for s in slots),
                        message=message,
                    )
                )
    return out


def _unallocated_teachers(scope: Scope) -> list[Conflict]:
    """§11: the teacher must hold an allocation for this section and subject.

    Hard, because scheduling someone to teach a subject they were never
    allocated is the timetable contradicting academics — and examinations would
    then derive marks-entry rights from an allocation that does not exist.
    """
    # Grouped by the missing allocation, not by slot. One absent allocation is
    # one thing to fix in academics, and a teacher who holds a subject five
    # periods a week would otherwise fill the conflict panel with five identical
    # rows that all resolve together.
    missing: dict = defaultdict(list)
    for slot in scope.slots:
        if not slot.staff_id or not slot.subject_id:
            continue
        key = (slot.section_id, slot.subject_id, slot.staff_id)
        if key not in scope.allocations:
            missing[key].append(slot)

    return [
        Conflict(
            type="teacher_not_allocated",
            severity="hard",
            slot_ids=sorted(str(s.pk) for s in slots),
            message=(
                "This teacher has no allocation for this section and subject. "
                "Allocate them in academics first."
            ),
        )
        for slots in missing.values()
    ]


def _break_and_campus_mismatches(scope: Scope) -> list[Conflict]:
    out = []
    for slot in scope.slots:
        if slot.period_id in scope.break_period_ids:
            out.append(
                Conflict(
                    type="period_is_break",
                    severity="hard",
                    slot_ids=[str(slot.pk)],
                    message="This period is a break and cannot be scheduled.",
                )
            )
            continue

        period_campus = scope.period_campus.get(slot.period_id)
        section_campus = scope.section_campus.get(slot.section_id)
        # A null period campus means "every campus", which never mismatches.
        if period_campus is not None and section_campus != period_campus:
            out.append(
                Conflict(
                    type="period_wrong_campus",
                    severity="hard",
                    slot_ids=[str(slot.pk)],
                    message="This period belongs to a different campus than the section.",
                )
            )

        # §5.1's per-weekday day templates: a short Friday has fewer periods than
        # a Monday, and `Period.weekdays` is where that is stored. Without this
        # check the column is written and never read — a slot could sit in a
        # period whose bell does not ring that day and publish cleanly. Hard, for
        # the same reason `period_is_break` is: it is not a preference, the
        # period does not exist on that weekday.
        #
        # Null means "the tenant's working days", which is every day this module
        # can currently reason about, so it never mismatches — exactly like a
        # null campus above.
        weekdays = scope.period_weekdays.get(slot.period_id)
        if weekdays and slot.day_of_week not in weekdays:
            out.append(
                Conflict(
                    type="period_not_on_weekday",
                    severity="hard",
                    slot_ids=[str(slot.pk)],
                    message="This period does not run on that weekday.",
                )
            )
    return out


def _room_over_capacity(scope: Scope) -> list[Conflict]:
    """§11 calls this a soft warning explicitly — a room one seat short is a
    problem to know about, not a reason to block the whole timetable."""
    out = []
    for slot in scope.slots:
        if not slot.room_id:
            continue
        capacity = scope.room_capacity.get(slot.room_id)
        size = scope.section_sizes.get(slot.section_id, 0)
        if capacity is not None and size > capacity:
            out.append(
                Conflict(
                    type="room_over_capacity",
                    severity="soft",
                    slot_ids=[str(slot.pk)],
                    message=f"This room seats {capacity}; the section has {size} students.",
                )
            )
    return out


def _subject_repeated_in_a_day(scope: Scope, limits: Thresholds) -> list[Conflict]:
    grouped: dict = defaultdict(list)
    for slot in scope.slots:
        if slot.subject_id:
            grouped[(slot.section_id, slot.day_of_week, slot.subject_id)].append(slot)

    return [
        Conflict(
            type="subject_repeated_in_day",
            severity="soft",
            slot_ids=sorted(str(s.pk) for s in slots),
            message=f"This subject appears {len(slots)} times on one day.",
        )
        for slots in grouped.values()
        if len(slots) > limits.max_subject_occurrences_per_day
    ]


def _consecutive_load(scope: Scope, limits: Thresholds) -> list[Conflict]:
    """A teacher scheduled for more than N periods back to back.

    Consecutiveness is measured on the period's `sequence`, not its id: ids carry
    no order, and a run is only a run if the periods actually adjoin in the day.
    """
    by_teacher_day: dict = defaultdict(list)
    for slot in scope.slots:
        if slot.staff_id:
            by_teacher_day[(slot.staff_id, slot.day_of_week)].append(slot)

    out = []
    for slots in by_teacher_day.values():
        ordered = sorted(slots, key=lambda s: s.period.sequence)
        run = [ordered[0]]
        for previous, current in zip(ordered, ordered[1:], strict=False):
            if current.period.sequence == previous.period.sequence + 1:
                run.append(current)
            else:
                out.extend(_run_conflict(run, limits))
                run = [current]
        out.extend(_run_conflict(run, limits))
    return out


def _run_conflict(run: list, limits: Thresholds) -> list[Conflict]:
    if len(run) <= limits.max_consecutive_periods:
        return []
    return [
        Conflict(
            type="consecutive_periods_over_threshold",
            severity="soft",
            slot_ids=sorted(str(s.pk) for s in run),
            message=(
                f"This teacher has {len(run)} consecutive periods; "
                f"the limit is {limits.max_consecutive_periods}."
            ),
        )
    ]
