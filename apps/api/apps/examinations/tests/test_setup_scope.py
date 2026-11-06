"""Record scope `assigned` on exam setup — §4's teacher view of exams.

§4 gives a `teacher` `exams.exam.view` scoped to what they teach. Before these
hooks existed, `scope_queryset` reached `assigned`, found no
`Exam.filter_assigned_to_user`, and fell through to `.none()`: a teacher's exam
list was always empty, however many papers they taught.

The fixture's two teachers are the two halves of "assigned" (see base.py): the
subject teacher holds an allocation for (section, subject) in the current
session; the class teacher is the section's homeroom teacher. Each test acts as
one of them with exactly one key, `assigned`-scoped, so a row appearing can only
be the hook's doing.
"""

from __future__ import annotations

from rest_framework import status

from apps.examinations.models import Exam, ExamSubject
from apps.examinations.tests.base import ExaminationsAPITestCase
from apps.examinations.tests.factories import (
    AcademicSessionFactory,
    ClassFactory,
    ExamFactory,
    ExamSubjectFactory,
    SectionFactory,
    SubjectFactory,
    TeacherAllocationFactory,
    authenticate,
    complete_scale,
    grant,
)
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

EXAMS = "/api/v1/exams"
EXAM_SUBJECTS = "/api/v1/exam-subjects"
SCALES = "/api/v1/grading-scales"


class SetupScopeTestCase(ExaminationsAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            # Taught: the allocated (class, subject) in the allocation's session.
            self.taught = ExamFactory(
                tenant=self.tenant, academic_session=self.session, grading_scale=self.scale
            )
            self.taught_subject = ExamSubjectFactory(
                tenant=self.tenant,
                exam=self.taught,
                school_class=self.school_class,
                subject=self.subject,
            )
            # Not taught by anyone in the fixture: another class, another subject.
            self.other_class = ClassFactory(tenant=self.tenant, level=9)
            self.other_subject = SubjectFactory(tenant=self.tenant)
            self.untaught = ExamFactory(
                tenant=self.tenant, academic_session=self.session, grading_scale=self.scale
            )
            ExamSubjectFactory(
                tenant=self.tenant,
                exam=self.untaught,
                school_class=self.other_class,
                subject=self.other_subject,
            )

    def act_as(self, user, *keys: str) -> None:
        grant(user, *keys, scope=RecordScope.ASSIGNED)
        authenticate(self.client, user)

    def listed(self, url: str) -> set[str]:
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return {row["id"] for row in response.json()["data"]}


class ExamAssignedScopeTests(SetupScopeTestCase):
    def test_assigned_only_teacher_lists_the_exams_they_teach(self) -> None:
        self.act_as(self.subject_teacher_user, "exams.exam.view")

        self.assertEqual(self.listed(EXAMS), {str(self.taught.pk)})

    def test_an_allocation_in_another_session_does_not_show_the_exam(self) -> None:
        """Same class, same subject, last year's paper: not this teacher's."""
        with tenant_context(self.tenant.id):
            last_year = AcademicSessionFactory(tenant=self.tenant, is_current=False)
            old = ExamFactory(
                tenant=self.tenant, academic_session=last_year, grading_scale=self.scale
            )
            ExamSubjectFactory(
                tenant=self.tenant, exam=old, school_class=self.school_class, subject=self.subject
            )
        self.act_as(self.subject_teacher_user, "exams.exam.view")

        listed = self.listed(EXAMS)

        self.assertNotIn(str(old.pk), listed)
        self.assertIn(str(self.taught.pk), listed)

    def test_an_end_dated_allocation_shows_nothing(self) -> None:
        with tenant_context(self.tenant.id):
            self.allocation.effective_to = self.session.end_date
            self.allocation.save(update_fields=["effective_to", "updated_at"])
        self.act_as(self.subject_teacher_user, "exams.exam.view")

        self.assertEqual(self.listed(EXAMS), set())

    def test_a_homeroom_teacher_sees_their_class_s_exams_in_any_subject(self) -> None:
        with tenant_context(self.tenant.id):
            other_subject_exam = ExamFactory(
                tenant=self.tenant, academic_session=self.session, grading_scale=self.scale
            )
            ExamSubjectFactory(
                tenant=self.tenant,
                exam=other_subject_exam,
                school_class=self.school_class,
                subject=self.other_subject,
            )
        self.act_as(self.teacher_user, "exams.exam.view")

        self.assertEqual(self.listed(EXAMS), {str(self.taught.pk), str(other_subject_exam.pk)})

    def test_a_homeroom_teacher_sees_only_this_session_s_exams_for_their_class(self) -> None:
        """The homeroom is this session's: last year's paper for the class is not theirs."""
        with tenant_context(self.tenant.id):
            last_year = AcademicSessionFactory(tenant=self.tenant, is_current=False)
            old = ExamFactory(
                tenant=self.tenant, academic_session=last_year, grading_scale=self.scale
            )
            ExamSubjectFactory(
                tenant=self.tenant, exam=old, school_class=self.school_class, subject=self.subject
            )
        self.act_as(self.teacher_user, "exams.exam.view")

        listed = self.listed(EXAMS)

        self.assertNotIn(str(old.pk), listed)
        self.assertIn(str(self.taught.pk), listed)

    def test_an_exam_with_two_taught_subjects_is_listed_once(self) -> None:
        """`pk__in`, not a fan-out join: two matching subjects are still one exam.

        The second allocation also covers `untaught`'s only subject, which is
        why it appears too — once.
        """
        with tenant_context(self.tenant.id):
            second_section = SectionFactory(
                tenant=self.tenant, school_class=self.other_class, campus=self.campus
            )
            TeacherAllocationFactory(
                tenant=self.tenant,
                academic_session=self.session,
                section=second_section,
                subject=self.other_subject,
                staff=self.subject_teacher,
            )
            ExamSubjectFactory(
                tenant=self.tenant,
                exam=self.taught,
                school_class=self.other_class,
                subject=self.other_subject,
            )
        self.act_as(self.subject_teacher_user, "exams.exam.view")

        response = self.client.get(EXAMS)

        ids = [row["id"] for row in response.json()["data"]]
        self.assertEqual(sorted(ids), sorted([str(self.taught.pk), str(self.untaught.pk)]))

    def test_a_user_with_no_staff_row_sees_nothing(self) -> None:
        self.act_as(self.user, "exams.exam.view")

        self.assertEqual(self.listed(EXAMS), set())

    def test_an_all_scoped_caller_sees_every_exam(self) -> None:
        self.allow_everything()

        self.assertEqual(self.listed(EXAMS), {str(self.taught.pk), str(self.untaught.pk)})

    def test_an_assigned_teacher_cannot_retrieve_an_exam_they_do_not_teach(self) -> None:
        self.act_as(self.subject_teacher_user, "exams.exam.view")

        response = self.client.get(f"{EXAMS}/{self.untaught.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class ExamSubjectAssignedScopeTests(SetupScopeTestCase):
    def test_a_subject_teacher_lists_only_the_subjects_they_teach(self) -> None:
        with tenant_context(self.tenant.id):
            sibling = ExamSubjectFactory(
                tenant=self.tenant,
                exam=self.taught,
                school_class=self.school_class,
                subject=self.other_subject,
            )
        self.act_as(self.subject_teacher_user, "exams.exam.view")

        listed = self.listed(EXAM_SUBJECTS)

        self.assertEqual(listed, {str(self.taught_subject.pk)})
        self.assertNotIn(str(sibling.pk), listed)

    def test_a_teacher_can_sort_their_subjects_by_name(self) -> None:
        """A subject teacher ordering by an annotated name still gets a 200."""
        self.act_as(self.subject_teacher_user, "exams.exam.view")

        response = self.client.get(f"{EXAM_SUBJECTS}?ordering=-subject_name")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())


class GradingScaleAssignedScopeTests(SetupScopeTestCase):
    def test_an_assigned_teacher_reads_every_scale_and_its_bands(self) -> None:
        """Tenant reference data: a teacher who can see an exam must be able to
        read the scale that grades it, and every other scale besides."""
        with tenant_context(self.tenant.id):
            second = complete_scale(self.tenant)
        self.act_as(self.subject_teacher_user, "exams.grading-scale.view")

        self.assertEqual(self.listed(SCALES), {str(self.scale.pk), str(second.pk)})
        bands = self.listed(f"{SCALES}/{second.pk}/grade-bands")
        self.assertEqual(len(bands), 5)


class ScopeHookAgreementTests(SetupScopeTestCase):
    # `Marks`' hook is pinned to `services.may_enter_marks` by
    # `test_marks_import_scope.PredicateAgreementTests`, across sessions.
    def test_exam_and_exam_subject_hooks_agree(self) -> None:
        """An exam is visible exactly when one of its subjects is."""
        with tenant_context(self.tenant.id):
            for user in (self.subject_teacher_user, self.teacher_user, self.user):
                with self.subTest(user=user.email):
                    subjects = ExamSubject.filter_assigned_to_user(
                        ExamSubject.objects.alive(), user
                    )
                    exams = Exam.filter_assigned_to_user(Exam.objects.alive(), user)
                    self.assertEqual(
                        set(exams.values_list("pk", flat=True)),
                        set(subjects.values_list("exam_id", flat=True)),
                    )
