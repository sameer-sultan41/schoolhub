"""The conflict engine, tested directly rather than through the API.

`conflicts.py` is the piece three callers share — the per-edit check, `:validate`
and `:publish` (§6) — so a bug here is a bug in all three at once, and it is worth
exercising without an HTTP round trip in the way.

Two properties matter beyond "does it find the clash":

- **Severity is the whole design.** §5.5 splits hard (blocks publish) from soft
  (warns only). A finding filed under the wrong severity either blocks a school
  from publishing over a room one seat short, or lets a double-booked teacher
  reach a classroom. Every test below asserts the severity, not just the type.
- **It must stay query-bounded.** The engine's own docstring promises a fixed
  number of queries regardless of grid size; `ConflictEngineQueryBudgetTests`
  is what stops that promise decaying into an N+1 the next time a detector
  needs one more column.
"""

from __future__ import annotations

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.timetable.conflicts import Thresholds, detect_conflicts, has_hard_conflicts
from apps.timetable.models import SlotStatus, TimetableSlot
from apps.timetable.tests.base import TimetableAPITestCase
from apps.timetable.tests.factories import (
    CampusFactory,
    PeriodFactory,
    RoomFactory,
    SectionFactory,
    StaffFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    SubjectFactory,
    TeacherAllocationFactory,
)
from core.tenancy.context import tenant_context


class ConflictEngineTestCase(TimetableAPITestCase):
    """Fixture-only; these tests never make a request, so no keys are granted."""

    def run_engine(self, section=None, thresholds: Thresholds | None = None) -> list[dict]:
        with tenant_context(self.tenant.id):
            return detect_conflicts(session=self.session, section=section, thresholds=thresholds)

    def types(self, conflicts: list[dict]) -> set[str]:
        return {conflict["type"] for conflict in conflicts}

    def of_type(self, conflicts: list[dict], kind: str) -> dict:
        matches = [conflict for conflict in conflicts if conflict["type"] == kind]
        self.assertEqual(len(matches), 1, f"expected exactly one {kind}, got {conflicts}")
        return matches[0]


class CleanGridTests(ConflictEngineTestCase):
    def test_a_well_formed_grid_reports_nothing(self) -> None:
        """The base fixture must be conflict-free, or every test below lies."""
        self.make_slot()

        self.assertEqual(self.run_engine(), [])

    def test_an_empty_session_reports_nothing(self) -> None:
        self.assertEqual(self.run_engine(), [])

    def test_has_hard_conflicts_is_false_for_a_clean_run(self) -> None:
        self.make_slot()

        self.assertFalse(has_hard_conflicts(self.run_engine()))


class HardConflictTests(ConflictEngineTestCase):
    def test_two_slots_in_one_section_cell_clash(self) -> None:
        first = self.make_slot()
        second = self.make_slot()

        finding = self.of_type(self.run_engine(), "section_double_booked")

        self.assertEqual(finding["severity"], "hard")
        self.assertEqual(finding["slot_ids"], sorted([str(first.pk), str(second.pk)]))

    def test_a_clash_names_both_sides_not_just_the_newer_row(self) -> None:
        """§6: a client highlights cells, so blaming whichever saved second is useless."""
        first = self.make_slot()
        second = self.make_slot()

        finding = self.of_type(self.run_engine(), "section_double_booked")

        self.assertIn(str(first.pk), finding["slot_ids"])
        self.assertIn(str(second.pk), finding["slot_ids"])

    def test_a_teacher_in_two_sections_at_once_clashes(self) -> None:
        with tenant_context(self.tenant.id):
            TeacherAllocationFactory(
                tenant=self.tenant,
                academic_session=self.session,
                section=self.other_section,
                subject=self.subject,
                staff=self.teacher,
            )
        self.make_slot()
        self.make_slot(section=self.other_section, room=None)

        finding = self.of_type(self.run_engine(), "teacher_double_booked")

        self.assertEqual(finding["severity"], "hard")
        self.assertEqual(len(finding["slot_ids"]), 2)

    def test_a_room_used_by_two_sections_at_once_clashes(self) -> None:
        with tenant_context(self.tenant.id):
            colleague = StaffFactory(tenant=self.tenant, campus=self.campus)
            TeacherAllocationFactory(
                tenant=self.tenant,
                academic_session=self.session,
                section=self.other_section,
                subject=self.subject,
                staff=colleague,
            )
        self.make_slot()
        self.make_slot(section=self.other_section, staff=colleague)

        finding = self.of_type(self.run_engine(), "room_double_booked")

        self.assertEqual(finding["severity"], "hard")

    def test_a_slot_with_no_room_never_reports_a_room_clash(self) -> None:
        """`room_id IS NULL` is "unassigned", not "the null room, booked twice"."""
        with tenant_context(self.tenant.id):
            colleague = StaffFactory(tenant=self.tenant, campus=self.campus)
            TeacherAllocationFactory(
                tenant=self.tenant,
                academic_session=self.session,
                section=self.other_section,
                subject=self.subject,
                staff=colleague,
            )
        self.make_slot(room=None)
        self.make_slot(section=self.other_section, staff=colleague, room=None)

        self.assertNotIn("room_double_booked", self.types(self.run_engine()))

    def test_a_slot_with_no_teacher_never_reports_a_teacher_clash(self) -> None:
        self.make_slot(staff=None, subject=None, room=None)
        self.make_slot(section=self.other_section, staff=None, subject=None, room=None)

        self.assertNotIn("teacher_double_booked", self.types(self.run_engine()))

    def test_a_teacher_without_an_allocation_is_hard(self) -> None:
        """§11 — otherwise the timetable contradicts academics, and marks-entry
        rights in examinations would derive from an allocation that never existed."""
        with tenant_context(self.tenant.id):
            stranger = StaffFactory(tenant=self.tenant, campus=self.campus)
        slot = self.make_slot(staff=stranger)

        finding = self.of_type(self.run_engine(), "teacher_not_allocated")

        self.assertEqual(finding["severity"], "hard")
        self.assertEqual(finding["slot_ids"], [str(slot.pk)])

    def test_a_slot_with_no_subject_is_never_unallocated(self) -> None:
        """A homeroom period has no subject to be allocated for."""
        self.make_slot(subject=None)

        self.assertNotIn("teacher_not_allocated", self.types(self.run_engine()))

    def test_scheduling_a_break_is_hard(self) -> None:
        """§5.1 — breaks are never schedulable."""
        with tenant_context(self.tenant.id):
            recess = PeriodFactory(tenant=self.tenant, sequence=50, is_break=True)
        slot = self.make_slot(period=recess)

        finding = self.of_type(self.run_engine(), "period_is_break")

        self.assertEqual(finding["severity"], "hard")
        self.assertEqual(finding["slot_ids"], [str(slot.pk)])

    def test_a_period_from_another_campus_is_hard(self) -> None:
        with tenant_context(self.tenant.id):
            other_campus = CampusFactory(tenant=self.tenant)
            foreign_period = PeriodFactory(tenant=self.tenant, sequence=51, campus=other_campus)
        self.make_slot(period=foreign_period)

        finding = self.of_type(self.run_engine(), "period_wrong_campus")

        self.assertEqual(finding["severity"], "hard")

    def test_a_tenant_wide_period_never_mismatches_a_campus(self) -> None:
        """Null campus means "every campus" — the base fixture relies on it."""
        self.make_slot()

        self.assertNotIn("period_wrong_campus", self.types(self.run_engine()))

    def test_a_break_short_circuits_the_campus_check(self) -> None:
        """One finding per slot, not two: the break is the thing to fix."""
        with tenant_context(self.tenant.id):
            other_campus = CampusFactory(tenant=self.tenant)
            foreign_break = PeriodFactory(
                tenant=self.tenant, sequence=52, campus=other_campus, is_break=True
            )
        self.make_slot(period=foreign_break)

        types = self.types(self.run_engine())

        self.assertIn("period_is_break", types)
        self.assertNotIn("period_wrong_campus", types)

    def test_has_hard_conflicts_is_true_when_one_is_present(self) -> None:
        self.make_slot()
        self.make_slot()

        self.assertTrue(has_hard_conflicts(self.run_engine()))


class SoftConflictTests(ConflictEngineTestCase):
    def _enroll(self, count: int, section=None) -> None:
        with tenant_context(self.tenant.id):
            for _ in range(count):
                student = StudentFactory(tenant=self.tenant, campus=self.campus)
                StudentEnrollmentFactory(
                    tenant=self.tenant,
                    student=student,
                    academic_session=self.session,
                    school_class=self.school_class,
                    section=section or self.section,
                )

    def test_a_room_smaller_than_the_section_only_warns(self) -> None:
        """§11 calls this out explicitly as a warning."""
        with tenant_context(self.tenant.id):
            self.room.capacity = 1
            self.room.save(update_fields=["capacity"])
        self._enroll(2)
        self.make_slot()

        finding = self.of_type(self.run_engine(), "room_over_capacity")

        self.assertEqual(finding["severity"], "soft")
        self.assertIn("2 students", finding["message"])

    def test_a_room_exactly_the_right_size_is_fine(self) -> None:
        """`>`, not `>=`: a room that seats the class exactly is not over capacity."""
        with tenant_context(self.tenant.id):
            self.room.capacity = 2
            self.room.save(update_fields=["capacity"])
        self._enroll(2)
        self.make_slot()

        self.assertNotIn("room_over_capacity", self.types(self.run_engine()))

    def test_a_room_with_no_stated_capacity_never_warns(self) -> None:
        with tenant_context(self.tenant.id):
            self.room.capacity = None
            self.room.save(update_fields=["capacity"])
        self._enroll(5)
        self.make_slot()

        self.assertNotIn("room_over_capacity", self.types(self.run_engine()))

    def test_a_subject_twice_in_one_day_only_warns(self) -> None:
        first = self.make_slot()
        second = self.make_slot(period=self.periods[1])

        finding = self.of_type(self.run_engine(), "subject_repeated_in_day")

        self.assertEqual(finding["severity"], "soft")
        self.assertEqual(finding["slot_ids"], sorted([str(first.pk), str(second.pk)]))

    def test_the_same_subject_on_different_days_is_not_a_repeat(self) -> None:
        self.make_slot(day_of_week=0)
        self.make_slot(day_of_week=1)

        self.assertNotIn("subject_repeated_in_day", self.types(self.run_engine()))

    def test_the_repeat_threshold_is_configurable(self) -> None:
        """§5.5 — "thresholds tenant-configurable", pending a TenantSettings namespace."""
        self.make_slot()
        self.make_slot(period=self.periods[1])

        relaxed = self.run_engine(thresholds=Thresholds(max_subject_occurrences_per_day=2))

        self.assertNotIn("subject_repeated_in_day", self.types(relaxed))

    def _consecutive_run(self, length: int) -> list:
        """`length` back-to-back periods for the base teacher, one per subject.

        A subject each so the run does not also trip `subject_repeated_in_day`,
        and an allocation each so it does not trip `teacher_not_allocated` —
        this test is about the run, and a fixture that fired three findings
        would not prove which one the assertion caught.
        """
        slots = []
        with tenant_context(self.tenant.id):
            # Sequences 1-4 already belong to the base fixture, and the column
            # is unique per campus with NULLs treated as equal — so the run gets
            # its own contiguous band rather than colliding with them.
            periods = [
                PeriodFactory(tenant=self.tenant, sequence=sequence)
                for sequence in range(20, 20 + length)
            ]
        for period in periods:
            with tenant_context(self.tenant.id):
                subject = SubjectFactory(tenant=self.tenant)
                TeacherAllocationFactory(
                    tenant=self.tenant,
                    academic_session=self.session,
                    section=self.section,
                    subject=subject,
                    staff=self.teacher,
                )
            slots.append(self.make_slot(period=period, subject=subject, room=None))
        return slots

    def test_a_long_consecutive_run_only_warns(self) -> None:
        slots = self._consecutive_run(4)

        finding = self.of_type(self.run_engine(), "consecutive_periods_over_threshold")

        self.assertEqual(finding["severity"], "soft")
        self.assertEqual(finding["slot_ids"], sorted(str(slot.pk) for slot in slots))

    def test_a_run_at_the_threshold_is_not_reported(self) -> None:
        self._consecutive_run(3)

        self.assertNotIn("consecutive_periods_over_threshold", self.types(self.run_engine()))

    def test_the_consecutive_threshold_is_configurable(self) -> None:
        self._consecutive_run(4)

        relaxed = self.run_engine(thresholds=Thresholds(max_consecutive_periods=4))

        self.assertNotIn("consecutive_periods_over_threshold", self.types(relaxed))

    def test_a_gap_breaks_a_run(self) -> None:
        """Consecutiveness is measured on `sequence` — ids carry no order."""
        with tenant_context(self.tenant.id):
            far = PeriodFactory(tenant=self.tenant, sequence=60)
        for period in (self.periods[0], self.periods[1], self.periods[2], far):
            with tenant_context(self.tenant.id):
                subject = SubjectFactory(tenant=self.tenant)
                TeacherAllocationFactory(
                    tenant=self.tenant,
                    academic_session=self.session,
                    section=self.section,
                    subject=subject,
                    staff=self.teacher,
                )
            self.make_slot(period=period, subject=subject, room=None)

        self.assertNotIn("consecutive_periods_over_threshold", self.types(self.run_engine()))


class ConflictScopeTests(ConflictEngineTestCase):
    def test_drafts_count(self) -> None:
        """A draft clash is exactly what `:validate` exists to surface."""
        self.make_slot(status=SlotStatus.DRAFT)
        self.make_slot(status=SlotStatus.DRAFT)

        self.assertIn("section_double_booked", self.types(self.run_engine()))

    def test_a_draft_does_not_clash_with_the_cell_it_replaces(self) -> None:
        """§5.7 edits a live cell by drafting over it and republishing, so a draft
        and a published row in one cell are two versions of it, not two classes at
        once. Judged against each other they are a section clash — and, since a
        revision usually keeps the teacher and the room, a teacher and a room
        clash too, all three hard. `:publish` would then refuse the single edit
        the draft/publish flow exists to make.
        """
        self.publish(self.make_slot())
        self.make_slot()

        self.assertEqual(self.run_engine(), [])

    def test_replacing_one_cell_does_not_excuse_another_section(self) -> None:
        """Only the cell being replaced drops out of the comparison. A teacher
        published elsewhere in that period is still double-booked by the draft."""
        with tenant_context(self.tenant.id):
            TeacherAllocationFactory(
                tenant=self.tenant,
                academic_session=self.session,
                section=self.other_section,
                subject=self.subject,
                staff=self.teacher,
            )
        # The replaced cell holds no teacher of its own, so the only teacher in
        # play is the draft's — otherwise the two published rows would be the
        # double booking and the assertion would pass without the draft.
        self.publish(self.make_slot(staff=None, room=None))
        self.publish(self.make_slot(section=self.other_section, room=None))
        self.make_slot()

        self.assertIn("teacher_double_booked", self.types(self.run_engine()))

    def test_an_end_dated_slot_is_out_of_scope(self) -> None:
        """A superseded version must not block its own replacement."""
        self.make_slot(status=SlotStatus.PUBLISHED, effective_to=self.session.start_date)
        self.make_slot()

        self.assertNotIn("section_double_booked", self.types(self.run_engine()))

    def test_a_soft_deleted_slot_is_out_of_scope(self) -> None:
        removed = self.make_slot()
        self.make_slot()
        with tenant_context(self.tenant.id):
            TimetableSlot.objects.filter(pk=removed.pk).update(deleted_at=timezone.now())

        self.assertNotIn("section_double_booked", self.types(self.run_engine()))

    def test_narrowing_to_a_section_still_compares_against_the_whole_session(self) -> None:
        """A teacher clash is by definition with some *other* section (collect_scope)."""
        with tenant_context(self.tenant.id):
            TeacherAllocationFactory(
                tenant=self.tenant,
                academic_session=self.session,
                section=self.other_section,
                subject=self.subject,
                staff=self.teacher,
            )
        self.make_slot()
        self.make_slot(section=self.other_section, room=None)

        narrowed = self.run_engine(section=self.section)

        self.assertIn("teacher_double_booked", self.types(narrowed))

    def test_narrowing_drops_findings_that_touch_no_slot_of_that_section(self) -> None:
        with tenant_context(self.tenant.id):
            stranger = StaffFactory(tenant=self.tenant, campus=self.campus)
        self.make_slot(section=self.other_section, staff=stranger, room=None)

        narrowed = self.run_engine(section=self.section)

        self.assertEqual(narrowed, [])
        self.assertIn("teacher_not_allocated", self.types(self.run_engine()))

    def test_hard_findings_sort_ahead_of_soft_ones(self) -> None:
        """A client showing the top few must not lead with a warning."""
        with tenant_context(self.tenant.id):
            self.room.capacity = 1
            self.room.save(update_fields=["capacity"])
            for _ in range(2):
                student = StudentFactory(tenant=self.tenant, campus=self.campus)
                StudentEnrollmentFactory(
                    tenant=self.tenant,
                    student=student,
                    academic_session=self.session,
                    school_class=self.school_class,
                    section=self.section,
                )
        self.make_slot()
        self.make_slot()

        severities = [conflict["severity"] for conflict in self.run_engine()]

        self.assertIn("hard", severities)
        self.assertIn("soft", severities)
        self.assertEqual(severities, sorted(severities, key=lambda s: s != "hard"))

    def test_every_finding_carries_the_documented_shape(self) -> None:
        """§6 promises `{type, severity, slot_ids, message}` — the client reads all four."""
        self.make_slot()
        self.make_slot()

        for conflict in self.run_engine():
            self.assertEqual(set(conflict), {"type", "severity", "slot_ids", "message"})
            self.assertIn(conflict["severity"], {"hard", "soft"})
            self.assertTrue(conflict["message"])
            self.assertTrue(conflict["slot_ids"])


class ConflictEngineQueryBudgetTests(ConflictEngineTestCase):
    """The engine's central promise: a fixed query count, whatever the grid size.

    A section's week is roughly forty cells and the grid renders all of them at
    once, so the obvious "for each slot, query for a clash" shape would be forty
    round trips per render. These assert the shape has not quietly regressed to
    that — by comparing counts rather than pinning a literal, so adding a
    legitimate seventh lookup to `collect_scope` does not fail the build while
    still catching anything that scales with the data.
    """

    def _count_queries(self) -> int:
        with tenant_context(self.tenant.id), CaptureQueriesContext(connection) as captured:
            detect_conflicts(session=self.session)
        return len(captured)

    def test_the_query_count_does_not_grow_with_the_number_of_slots(self) -> None:
        self.make_slot()
        small = self._count_queries()

        with tenant_context(self.tenant.id):
            periods = [
                PeriodFactory(tenant=self.tenant, sequence=sequence) for sequence in range(100, 110)
            ]
        for day in range(4):
            for period in periods:
                self.make_slot(period=period, day_of_week=day, room=None)

        self.assertEqual(self._count_queries(), small)

    def test_the_query_count_does_not_grow_with_the_number_of_sections(self) -> None:
        self.make_slot()
        small = self._count_queries()

        with tenant_context(self.tenant.id):
            for index in range(10):
                section = SectionFactory(
                    tenant=self.tenant,
                    school_class=self.school_class,
                    campus=self.campus,
                    name=f"Q{index}",
                )
                RoomFactory(tenant=self.tenant, campus=self.campus)
                staff = StaffFactory(tenant=self.tenant, campus=self.campus)
                TeacherAllocationFactory(
                    tenant=self.tenant,
                    academic_session=self.session,
                    section=section,
                    subject=self.subject,
                    staff=staff,
                )

        self.assertEqual(self._count_queries(), small)

    def test_the_whole_run_stays_inside_a_small_absolute_budget(self) -> None:
        """A constant-but-creeping query count is still a regression worth catching."""
        self.make_slot()

        self.assertLessEqual(self._count_queries(), 10)


class ConflictEngineWithoutFixtureTests(TestCase):
    """`has_hard_conflicts` is a pure predicate and needs no database at all."""

    def test_it_reads_the_severity_key(self) -> None:
        self.assertTrue(has_hard_conflicts([{"severity": "soft"}, {"severity": "hard"}]))
        self.assertFalse(has_hard_conflicts([{"severity": "soft"}]))
        self.assertFalse(has_hard_conflicts([]))


class PeriodWeekdayTests(ConflictEngineTestCase):
    """§5.1's per-weekday day templates.

    `Period.weekdays` stores which days a period runs — that is how a short
    Friday has fewer periods than a Monday. It was stored and never read: a slot
    could sit in a Friday-only period on a Monday and publish cleanly, which
    makes the column decoration.
    """

    def friday_only_period(self):
        with tenant_context(self.tenant.id):
            return PeriodFactory(tenant=self.tenant, sequence=9, weekdays=[4])

    def test_a_slot_on_a_weekday_the_period_does_not_run_is_a_hard_conflict(self) -> None:
        self.make_slot(period=self.friday_only_period(), day_of_week=0)

        finding = self.of_type(self.run_engine(), "period_not_on_weekday")

        self.assertEqual(finding["severity"], "hard")

    def test_the_same_period_on_its_own_weekday_is_clean(self) -> None:
        self.make_slot(period=self.friday_only_period(), day_of_week=4)

        self.assertNotIn("period_not_on_weekday", self.types(self.run_engine()))

    def test_a_null_weekdays_period_runs_every_day(self) -> None:
        """Null means "the tenant's working days" — it never mismatches, the same
        way a null campus never mismatches."""
        self.make_slot(day_of_week=3)

        self.assertNotIn("period_not_on_weekday", self.types(self.run_engine()))

    def test_an_empty_weekdays_list_is_treated_as_unset(self) -> None:
        """`[]` is what a form that cleared every checkbox sends. Reading it as
        "runs on no day" would flag every slot in the period, which is a worse
        answer than treating it the way null is treated."""
        with tenant_context(self.tenant.id):
            period = PeriodFactory(tenant=self.tenant, sequence=10, weekdays=[])
        self.make_slot(period=period, day_of_week=1)

        self.assertNotIn("period_not_on_weekday", self.types(self.run_engine()))


class UnallocatedTeacherGroupingTests(ConflictEngineTestCase):
    """One missing allocation is one finding, however many periods it covers.

    A teacher holding a subject five periods a week used to produce five
    identical findings that all resolve with a single allocation in academics —
    a conflict panel full of the same row.
    """

    def test_a_teacher_missing_one_allocation_reports_once_across_their_week(self) -> None:
        with tenant_context(self.tenant.id):
            stranger = StaffFactory(tenant=self.tenant, campus=self.campus)
        for day in (0, 1, 2):
            self.make_slot(staff=stranger, day_of_week=day, room=None)

        finding = self.of_type(self.run_engine(), "teacher_not_allocated")

        self.assertEqual(finding["severity"], "hard")
        self.assertEqual(len(finding["slot_ids"]), 3, "every affected cell is still named")

    def test_two_different_missing_allocations_stay_two_findings(self) -> None:
        with tenant_context(self.tenant.id):
            one = StaffFactory(tenant=self.tenant, campus=self.campus)
            two = StaffFactory(tenant=self.tenant, campus=self.campus)
        self.make_slot(staff=one, day_of_week=0, room=None)
        self.make_slot(staff=two, day_of_week=1, room=None)

        findings = [c for c in self.run_engine() if c["type"] == "teacher_not_allocated"]

        self.assertEqual(len(findings), 2)
