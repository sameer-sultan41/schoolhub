"""Database-level guarantees.

These assert the constraints rather than the services, because a constraint is
what still holds when a future importer, shell session or Celery task writes the
row without going through `services`.
"""

from __future__ import annotations

import uuid

from django.db import IntegrityError, transaction
from django.test import TestCase

from apps.academics.models import (
    PromotionDecision,
    PromotionStatus,
    StudentPromotion,
    TeacherSubjectAllocation,
)
from apps.academics.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    ClassSubjectFactory,
    SectionFactory,
    StaffFactory,
    SubjectFactory,
    TeacherAllocationFactory,
    TenantFactory,
    UserFactory,
)
from apps.student_management.tests.factories import (
    StudentEnrollmentFactory,
    StudentFactory,
)
from core.tenancy.context import tenant_context


class AllocationConstraintTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.session = AcademicSessionFactory(tenant=self.tenant)
            self.school_class = ClassFactory(tenant=self.tenant, level=6)
            self.section = SectionFactory(
                tenant=self.tenant, school_class=self.school_class, campus=self.campus
            )
            self.subject = SubjectFactory(tenant=self.tenant)
            ClassSubjectFactory(
                tenant=self.tenant,
                academic_session=self.session,
                school_class=self.school_class,
                subject=self.subject,
            )
            self.teacher = StaffFactory(tenant=self.tenant, campus=self.campus)

    def _allocate(self, **overrides):
        defaults = {
            "tenant": self.tenant,
            "academic_session": self.session,
            "section": self.section,
            "subject": self.subject,
            "staff": self.teacher,
        }
        defaults.update(overrides)
        return TeacherAllocationFactory(**defaults)

    def test_the_same_teacher_cannot_be_allocated_twice(self) -> None:
        with tenant_context(self.tenant.id):
            self._allocate()
            with self.assertRaises(IntegrityError), transaction.atomic():
                self._allocate()

    def test_only_one_current_primary_per_section_subject(self) -> None:
        with tenant_context(self.tenant.id):
            other = StaffFactory(tenant=self.tenant, campus=self.campus)
            self._allocate(is_primary=True)
            with self.assertRaises(IntegrityError), transaction.atomic():
                self._allocate(staff=other, is_primary=True)

    def test_an_end_dated_primary_frees_the_slot(self) -> None:
        """Reassignment preserves history — the constraint counts only current rows."""
        import datetime

        with tenant_context(self.tenant.id):
            other = StaffFactory(tenant=self.tenant, campus=self.campus)
            first = self._allocate(is_primary=True)
            TeacherSubjectAllocation.objects.filter(pk=first.pk).update(
                effective_to=datetime.date(2026, 6, 1)
            )

            replacement = self._allocate(staff=other, is_primary=True)

        self.assertTrue(replacement.is_primary)

    def test_co_teachers_may_coexist_with_a_primary(self) -> None:
        with tenant_context(self.tenant.id):
            other = StaffFactory(tenant=self.tenant, campus=self.campus)
            self._allocate(is_primary=True)
            co_teacher = self._allocate(staff=other, is_primary=False)

        self.assertFalse(co_teacher.is_primary)

    def test_an_effective_range_must_be_ordered(self) -> None:
        import datetime

        with tenant_context(self.tenant.id), self.assertRaises(IntegrityError):
            self._allocate(
                effective_from=datetime.date(2026, 9, 1),
                effective_to=datetime.date(2026, 1, 1),
            )

    def test_filter_owned_by_user_matches_a_teachers_own_allocations(self) -> None:
        user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            self.teacher.user_id = user.pk
            self.teacher.save(update_fields=["user_id"])
            mine = self._allocate()

            stranger = StaffFactory(tenant=self.tenant, campus=self.campus)
            other_subject = SubjectFactory(tenant=self.tenant)
            ClassSubjectFactory(
                tenant=self.tenant,
                academic_session=self.session,
                school_class=self.school_class,
                subject=other_subject,
            )
            self._allocate(staff=stranger, subject=other_subject)

            scoped = TeacherSubjectAllocation.filter_owned_by_user(
                TeacherSubjectAllocation.objects.alive(), user
            )
            ids = set(scoped.values_list("pk", flat=True))

        self.assertEqual(ids, {mine.pk})

    def test_filter_owned_by_user_matches_nothing_for_an_anonymous_user(self) -> None:
        with tenant_context(self.tenant.id):
            self._allocate()
            scoped = TeacherSubjectAllocation.filter_owned_by_user(
                TeacherSubjectAllocation.objects.alive(), None
            )
            self.assertEqual(scoped.count(), 0)


class PromotionConstraintTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.session = AcademicSessionFactory(tenant=self.tenant)
            self.next_session = AcademicSessionFactory(tenant=self.tenant)
            self.school_class = ClassFactory(tenant=self.tenant, level=6)
            self.next_class = ClassFactory(tenant=self.tenant, level=7)
            self.section = SectionFactory(
                tenant=self.tenant, school_class=self.school_class, campus=self.campus
            )
            self.student = StudentFactory(tenant=self.tenant, campus=self.campus)
            self.enrollment = StudentEnrollmentFactory(
                tenant=self.tenant,
                student=self.student,
                academic_session=self.session,
                school_class=self.school_class,
                section=self.section,
            )

    def _promotion(self, **overrides) -> StudentPromotion:
        defaults = {
            "tenant": self.tenant,
            "batch_id": uuid.uuid4(),
            "student": self.student,
            "from_enrollment": self.enrollment,
            "from_academic_session": self.session,
            "to_academic_session": self.next_session,
            "from_class": self.school_class,
            "to_class": self.next_class,
            "decision": PromotionDecision.PROMOTED,
            "status": PromotionStatus.DRAFT,
        }
        defaults.update(overrides)
        return StudentPromotion.objects.create(**defaults)

    def test_one_decision_per_student_per_batch(self) -> None:
        batch = uuid.uuid4()
        with tenant_context(self.tenant.id):
            self._promotion(batch_id=batch)
            with self.assertRaises(IntegrityError), transaction.atomic():
                self._promotion(batch_id=batch)

    def test_a_graduating_student_may_not_have_a_target_class(self) -> None:
        with tenant_context(self.tenant.id), self.assertRaises(IntegrityError):
            self._promotion(decision=PromotionDecision.GRADUATED, to_class=self.next_class)

    def test_a_non_graduating_student_must_have_a_target_class(self) -> None:
        with tenant_context(self.tenant.id), self.assertRaises(IntegrityError):
            self._promotion(decision=PromotionDecision.PROMOTED, to_class=None)

    def test_graduated_with_no_target_class_is_accepted(self) -> None:
        with tenant_context(self.tenant.id):
            row = self._promotion(decision=PromotionDecision.GRADUATED, to_class=None)
        self.assertIsNone(row.to_class_id)

    def test_approval_fields_move_together(self) -> None:
        """An approver with no timestamp, or a timestamp with no approver, is a
        half-written approval trail — the audit question is "who and when"."""
        from django.db import transaction
        from django.utils import timezone

        # Each half needs its own `atomic` block. A constraint violation marks
        # the surrounding transaction unusable, so without one the second
        # assertion never reaches the database — it fails with
        # TransactionManagementError and would pass for the wrong reason if the
        # constraint were dropped.
        for fields in (
            {"approved_by": uuid.uuid4(), "approved_at": None},
            {"approved_by": None, "approved_at": timezone.now()},
        ):
            with (
                self.subTest(**{k: v is not None for k, v in fields.items()}),
                # tenant_context outermost: its `SET LOCAL app.tenant_id` must
                # be set before the savepoint, or rolling the savepoint back
                # would unbind the tenant for whatever runs next.
                tenant_context(self.tenant.id),
                # assertRaises outside atomic, so atomic sees the exception,
                # rolls the savepoint back and re-raises. The other order lets
                # assertRaises swallow it and atomic then tries to commit a
                # transaction the database has already marked unusable.
                self.assertRaises(IntegrityError),
                transaction.atomic(),
            ):
                self._promotion(**fields)
