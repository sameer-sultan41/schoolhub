"""The constraints, asserted against a real PostgreSQL.

Each case names the rule it pins rather than the column it touches. The ones
worth reading twice are the partial uniques: every uniqueness rule in this
module is scoped to live rows, so a soft-deleted predecessor never blocks its
replacement — which is what makes "delete the exam and recreate it" a workable
correction rather than a dead end.
"""

from __future__ import annotations

import datetime
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone

from apps.examinations.models import ExamType, ScaleType
from apps.examinations.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    ExamFactory,
    ExamSubjectFactory,
    GradeBandFactory,
    GradingScaleFactory,
    SubjectFactory,
    TenantFactory,
    complete_scale,
)
from core.tenancy.context import tenant_context


class ExaminationsModelTestCase(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.session = AcademicSessionFactory(tenant=self.tenant, is_current=True)
            self.school_class = ClassFactory(tenant=self.tenant, level=8)
            self.subject = SubjectFactory(tenant=self.tenant)
            self.scale = complete_scale(self.tenant)

    def assertRefused(self, build, **kwargs) -> None:
        """Assert `build(**kwargs)` violates a database constraint.

        A savepoint per case, because an IntegrityError poisons the surrounding
        transaction and `TestCase` wraps the whole method in one — without it
        the *next* assertion in the same test fails for the wrong reason.
        """
        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            self.assertRaises(IntegrityError),
        ):
            build(**kwargs)


class GradingScaleConstraintTests(ExaminationsModelTestCase):
    def test_two_defaults_cannot_coexist(self) -> None:
        with tenant_context(self.tenant.id):
            GradingScaleFactory(tenant=self.tenant, is_default=True)

        self.assertRefused(GradingScaleFactory, tenant=self.tenant, is_default=True)

    def test_a_soft_deleted_default_does_not_block_its_replacement(self) -> None:
        """Replacing the default is "create the new one, clear the old", so the
        partial unique has to ignore the row that is on its way out."""
        with tenant_context(self.tenant.id):
            outgoing = GradingScaleFactory(tenant=self.tenant, is_default=True)
            outgoing.deleted_at = timezone.now()
            outgoing.save(update_fields=["deleted_at"])

            replacement = GradingScaleFactory(tenant=self.tenant, is_default=True)

        self.assertTrue(replacement.is_default)

    def test_two_scales_cannot_share_a_name(self) -> None:
        with tenant_context(self.tenant.id):
            GradingScaleFactory(tenant=self.tenant, name="Standard Letter Grades")

        self.assertRefused(GradingScaleFactory, tenant=self.tenant, name="Standard Letter Grades")

    def test_a_gpa_scale_without_a_maximum_is_refused(self) -> None:
        """A scale that cannot say what a perfect result is cannot compute a
        GPA. Caught here rather than in a result-processing job that would fail
        after grading half a school."""
        self.assertRefused(
            GradingScaleFactory, tenant=self.tenant, scale_type=ScaleType.GPA, gpa_max=None
        )

    def test_a_letter_scale_needs_no_maximum(self) -> None:
        """The control: the constraint must not demand a GPA maximum from a
        scale that does not grade on one."""
        with tenant_context(self.tenant.id):
            scale = GradingScaleFactory(
                tenant=self.tenant, scale_type=ScaleType.LETTER, gpa_max=None
            )

        self.assertIsNone(scale.gpa_max)


class GradeBandConstraintTests(ExaminationsModelTestCase):
    def test_a_band_whose_minimum_is_not_below_its_maximum_is_refused(self) -> None:
        self.assertRefused(
            GradeBandFactory,
            tenant=self.tenant,
            grading_scale=self.scale,
            label="X",
            min_percent=Decimal("60.00"),
            max_percent=Decimal("60.00"),
        )

    def test_a_band_outside_zero_to_hundred_is_refused(self) -> None:
        self.assertRefused(
            GradeBandFactory,
            tenant=self.tenant,
            grading_scale=self.scale,
            label="X",
            min_percent=Decimal("90.00"),
            max_percent=Decimal("110.00"),
        )

    def test_two_bands_in_one_scale_cannot_share_a_label(self) -> None:
        self.assertRefused(
            GradeBandFactory,
            tenant=self.tenant,
            grading_scale=self.scale,
            label="A",
            min_percent=Decimal("95.00"),
            max_percent=Decimal("100.00"),
        )

    def test_the_same_label_in_a_different_scale_is_fine(self) -> None:
        """A label is unique within its scale, not across a tenant: two schemes
        both having an `A` is the normal case, not a collision."""
        with tenant_context(self.tenant.id):
            other = GradingScaleFactory(tenant=self.tenant)
            band = GradeBandFactory(
                tenant=self.tenant,
                grading_scale=other,
                label="A",
                min_percent=Decimal("80.00"),
                max_percent=Decimal("100.00"),
            )

        self.assertEqual(band.label, "A")


class ExamConstraintTests(ExaminationsModelTestCase):
    def _exam(self, **kwargs):
        return ExamFactory(
            tenant=self.tenant,
            academic_session=self.session,
            grading_scale=self.scale,
            **kwargs,
        )

    def test_two_exams_in_one_session_cannot_share_a_name(self) -> None:
        with tenant_context(self.tenant.id):
            self._exam(name="Term 1 Midterm")

        self.assertRefused(self._exam, name="Term 1 Midterm")

    def test_the_same_name_in_another_session_is_fine(self) -> None:
        """An exam named Term 1 Midterm happens every year. Uniqueness is per
        session, which is what makes cloning last year's exam calendar possible
        at all."""
        with tenant_context(self.tenant.id):
            self._exam(name="Term 1 Midterm")
            next_session = AcademicSessionFactory(tenant=self.tenant)

            exam = ExamFactory(
                tenant=self.tenant,
                academic_session=next_session,
                grading_scale=self.scale,
                name="Term 1 Midterm",
            )

        self.assertEqual(exam.name, "Term 1 Midterm")

    def test_an_exam_ending_before_it_starts_is_refused(self) -> None:
        self.assertRefused(
            self._exam,
            starts_on=datetime.date(2026, 11, 10),
            ends_on=datetime.date(2026, 11, 3),
        )

    def test_one_date_alone_is_refused(self) -> None:
        """A draft exam legitimately has no dates. One date describes nothing a
        scheduler or an admit card can use, so the pair is set together."""
        self.assertRefused(self._exam, starts_on=datetime.date(2026, 11, 3), ends_on=None)

    def test_a_draft_exam_may_have_no_dates_at_all(self) -> None:
        with tenant_context(self.tenant.id):
            exam = self._exam(starts_on=None, ends_on=None)

        self.assertIsNone(exam.starts_on)

    def test_a_weightage_over_a_hundred_percent_is_refused(self) -> None:
        self.assertRefused(self._exam, weightage_percent=Decimal("120.00"))

    def test_a_zero_weightage_is_refused(self) -> None:
        """An exam contributing nothing to a consolidated result is either a
        configuration error or a reason not to create the exam."""
        self.assertRefused(self._exam, weightage_percent=Decimal("0.00"))


class ExamSubjectConstraintTests(ExaminationsModelTestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.exam = ExamFactory(
                tenant=self.tenant,
                academic_session=self.session,
                grading_scale=self.scale,
                exam_type=ExamType.FINAL,
            )

    def _subject_config(self, **kwargs):
        return ExamSubjectFactory(
            tenant=self.tenant,
            exam=self.exam,
            school_class=self.school_class,
            subject=self.subject,
            **kwargs,
        )

    def test_one_configuration_per_exam_class_and_subject(self) -> None:
        with tenant_context(self.tenant.id):
            self._subject_config()

        self.assertRefused(self._subject_config)

    def test_the_same_subject_in_another_class_is_a_separate_configuration(self) -> None:
        """The point of keying on the class: Maths is examined out of 50 in
        Grade 3 and out of 100 in Grade 9."""
        with tenant_context(self.tenant.id):
            self._subject_config()
            other_class = ClassFactory(tenant=self.tenant, level=3)

            config = ExamSubjectFactory(
                tenant=self.tenant,
                exam=self.exam,
                school_class=other_class,
                subject=self.subject,
                max_marks=Decimal("50.00"),
                pass_marks=Decimal("20.00"),
            )

        self.assertEqual(config.max_marks, Decimal("50.00"))

    def test_pass_marks_above_the_maximum_are_refused(self) -> None:
        self.assertRefused(
            self._subject_config, max_marks=Decimal("100.00"), pass_marks=Decimal("120.00")
        )

    def test_a_zero_maximum_is_refused(self) -> None:
        """Nothing can be marked out of nothing, and a percentage computed
        against it would be a division the processing job has to special-case."""
        self.assertRefused(self._subject_config, max_marks=Decimal("0.00"))

    def test_a_practical_component_without_a_maximum_is_refused(self) -> None:
        self.assertRefused(self._subject_config, has_practical=True, practical_max_marks=None)

    def test_a_practical_pass_above_its_maximum_is_refused(self) -> None:
        self.assertRefused(
            self._subject_config,
            has_practical=True,
            practical_max_marks=Decimal("30.00"),
            practical_pass_marks=Decimal("40.00"),
        )

    def test_an_entry_window_that_closes_before_it_opens_is_refused(self) -> None:
        now = timezone.now()

        self.assertRefused(
            self._subject_config,
            marks_entry_opens_at=now,
            marks_entry_closes_at=now - datetime.timedelta(days=1),
        )

    def test_no_entry_window_is_allowed(self) -> None:
        """An unset window means "not yet scheduled", which is the state an
        exam-subject is created in."""
        with tenant_context(self.tenant.id):
            config = self._subject_config()

        self.assertIsNone(config.marks_entry_opens_at)
