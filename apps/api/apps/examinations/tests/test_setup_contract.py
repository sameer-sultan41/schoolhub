"""The setup screens' read contract: names, counts, pagination and order.

The dashboard renders exams, their subject configurations and grading scales
as tables. These pin what each row carries — display names beside every id, a
live subject count — and that rendering a longer list costs no more queries
than a shorter one, which is the regression a name field brings with it.
"""

from __future__ import annotations

from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework import status

from apps.examinations.tests.base import ExaminationsAPITestCase
from apps.examinations.tests.factories import (
    AcademicSessionFactory,
    ClassFactory,
    ClassSubjectFactory,
    ExamFactory,
    ExamSubjectFactory,
    GradeBandFactory,
    GradingScaleFactory,
    SubjectFactory,
)
from core.tenancy.context import tenant_context

EXAMS = "/api/v1/exams"
EXAM_SUBJECTS = "/api/v1/exam-subjects"
SCALES = "/api/v1/grading-scales"


class SetupContractTestCase(ExaminationsAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow_everything()

    def exam(self, **kwargs):
        with tenant_context(self.tenant.id):
            return ExamFactory(
                tenant=self.tenant,
                academic_session=self.session,
                grading_scale=self.scale,
                **kwargs,
            )

    def configure(self, exam, school_class=None, subject=None):
        with tenant_context(self.tenant.id):
            return ExamSubjectFactory(
                tenant=self.tenant,
                exam=exam,
                school_class=school_class or self.school_class,
                subject=subject or self.subject,
            )

    def query_count(self, url: str) -> int:
        # Warm the per-user permission caches first, so the baseline counts the
        # list's own queries and not a cold first request.
        self.client.get(url)
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return len(queries)


class ExamContractTests(SetupContractTestCase):
    def test_a_listed_exam_carries_its_names_and_live_subject_count(self) -> None:
        exam = self.exam(term=self.term)
        self.configure(exam)
        with tenant_context(self.tenant.id):
            removed = self.configure(exam, subject=SubjectFactory(tenant=self.tenant))
            removed.deleted_at = removed.created_at
            removed.save(update_fields=["deleted_at"])

        row = self.client.get(EXAMS).json()["data"][0]

        self.assertEqual(row["academic_session_name"], self.session.name)
        self.assertEqual(row["term_name"], self.term.name)
        self.assertEqual(row["grading_scale_name"], self.scale.name)
        self.assertEqual(row["subject_count"], 1)

    def test_a_session_wide_exam_has_a_null_term_name(self) -> None:
        exam = self.exam()

        row = self.client.get(f"{EXAMS}/{exam.pk}").json()["data"]

        self.assertIsNone(row["term_name"])
        self.assertEqual(row["subject_count"], 0)

    def test_a_created_exam_reports_its_names_and_count(self) -> None:
        """The 201 body never passed through the annotated queryset (lesson L24)."""
        response = self.client.post(
            EXAMS,
            {
                "academic_session_id": str(self.session.pk),
                "name": "Annual Final",
                "exam_type": "final",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        data = response.json()["data"]
        self.assertEqual(data["subject_count"], 0)
        self.assertEqual(data["academic_session_name"], self.session.name)
        self.assertEqual(data["grading_scale_name"], self.scale.name)

    def test_an_updated_exam_keeps_its_subject_count(self) -> None:
        exam = self.exam()
        self.configure(exam)

        response = self.client.patch(f"{EXAMS}/{exam.pk}", {"name": "Renamed"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["subject_count"], 1)

    def test_exams_are_paged_by_number(self) -> None:
        for _ in range(3):
            self.exam()

        response = self.client.get(f"{EXAMS}?page_size=2&page=2")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(
            response.json()["meta"]["pagination"],
            {"page": 2, "page_size": 2, "total_count": 3, "total_pages": 2},
        )
        self.assertEqual(len(response.json()["data"]), 1)

    def test_same_name_undated_exams_page_apart_without_repeating(self) -> None:
        """The default order is total: `starts_on` and `name` tie, `id` breaks it."""
        with tenant_context(self.tenant.id):
            last_year = AcademicSessionFactory(tenant=self.tenant, is_current=False)
            ExamFactory(
                tenant=self.tenant,
                academic_session=last_year,
                grading_scale=self.scale,
                name="Midterm",
                starts_on=None,
            )
        self.exam(name="Midterm", starts_on=None)

        first = self.client.get(f"{EXAMS}?page_size=1&page=1")
        second = self.client.get(f"{EXAMS}?page_size=1&page=2")

        self.assertEqual(first.status_code, status.HTTP_200_OK, first.json())
        self.assertEqual(second.status_code, status.HTTP_200_OK, second.json())
        first_id = first.json()["data"][0]["id"]
        second_id = second.json()["data"][0]["id"]
        self.assertNotEqual(first_id, second_id)
        self.assertEqual(sorted([first_id, second_id]), [first_id, second_id])

    def test_the_exam_list_costs_the_same_for_one_row_or_many(self) -> None:
        self.configure(self.exam(term=self.term))
        baseline = self.query_count(EXAMS)
        for _ in range(4):
            exam = self.exam(term=self.term)
            self.configure(exam)
            with tenant_context(self.tenant.id):
                other = GradingScaleFactory(tenant=self.tenant)
            exam.grading_scale = other
            with tenant_context(self.tenant.id):
                exam.save(update_fields=["grading_scale"])

        with self.assertNumQueries(baseline):
            response = self.client.get(EXAMS)

        self.assertEqual(len(response.json()["data"]), 5)


class ExamSubjectContractTests(SetupContractTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.parent = self.exam()

    def test_an_exam_subject_carries_its_names(self) -> None:
        self.configure(self.parent)

        row = self.client.get(EXAM_SUBJECTS).json()["data"][0]

        self.assertEqual(row["exam_name"], self.parent.name)
        self.assertEqual(row["class_name"], self.school_class.name)
        self.assertEqual(row["subject_name"], self.subject.name)

    def test_exam_subjects_list_class_then_subject_by_default(self) -> None:
        with tenant_context(self.tenant.id):
            junior = ClassFactory(tenant=self.tenant, level=1, name="AAA Junior")
            senior = ClassFactory(tenant=self.tenant, level=12, name="ZZZ Senior")
            algebra = SubjectFactory(tenant=self.tenant, name="Algebra")
            zoology = SubjectFactory(tenant=self.tenant, name="Zoology")
            for school_class in (junior, senior):
                for subject in (algebra, zoology):
                    ClassSubjectFactory(
                        tenant=self.tenant,
                        academic_session=self.session,
                        school_class=school_class,
                        subject=subject,
                    )
        for school_class, subject in [
            (senior, algebra),
            (junior, zoology),
            (senior, zoology),
            (junior, algebra),
        ]:
            self.configure(self.parent, school_class=school_class, subject=subject)

        rows = self.client.get(f"{EXAM_SUBJECTS}?exam_id={self.parent.pk}").json()["data"]

        self.assertEqual(
            [(row["class_name"], row["subject_name"]) for row in rows],
            [
                ("AAA Junior", "Algebra"),
                ("AAA Junior", "Zoology"),
                ("ZZZ Senior", "Algebra"),
                ("ZZZ Senior", "Zoology"),
            ],
        )

    def test_following_next_cursor_serves_every_exam_subject_once(self) -> None:
        with tenant_context(self.tenant.id):
            classes = [
                ClassFactory(tenant=self.tenant, level=level, name=f"Cursor {level}")
                for level in (30, 31, 32)
            ]
            subjects = [SubjectFactory(tenant=self.tenant) for _ in range(2)]
            pairs = [(c, s) for c in classes for s in subjects][:5]
            for school_class, subject in pairs:
                ClassSubjectFactory(
                    tenant=self.tenant,
                    academic_session=self.session,
                    school_class=school_class,
                    subject=subject,
                )
        for school_class, subject in pairs:
            self.configure(self.parent, school_class=school_class, subject=subject)
        base = f"{EXAM_SUBJECTS}?exam_id={self.parent.pk}"
        expected = [row["id"] for row in self.client.get(f"{base}&page_size=100").json()["data"]]

        served: list[str] = []
        url = f"{base}&page_size=2"
        for _ in range(5):
            body = self.client.get(url).json()
            served.extend(row["id"] for row in body["data"])
            token = body["meta"]["pagination"]["next_cursor"]
            if token is None:
                break
            url = f"{base}&page_size=2&cursor={token}"

        self.assertEqual(len(expected), 5)
        self.assertEqual(served, expected)
        self.assertEqual(len(set(served)), len(served))

    def test_the_exam_subject_list_costs_the_same_for_one_row_or_many(self) -> None:
        self.configure(self.parent)
        baseline = self.query_count(EXAM_SUBJECTS)
        for level in range(20, 24):
            with tenant_context(self.tenant.id):
                school_class = ClassFactory(tenant=self.tenant, level=level)
                subject = SubjectFactory(tenant=self.tenant)
            self.configure(self.exam(), school_class=school_class, subject=subject)

        with self.assertNumQueries(baseline):
            response = self.client.get(EXAM_SUBJECTS)

        self.assertEqual(len(response.json()["data"]), 5)


class GradingScaleContractTests(SetupContractTestCase):
    def test_scales_are_paged_by_number(self) -> None:
        response = self.client.get(SCALES)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(
            response.json()["meta"]["pagination"],
            {"page": 1, "page_size": 25, "total_count": 1, "total_pages": 1},
        )

    def test_bands_are_unpaginated_and_in_sort_order(self) -> None:
        with tenant_context(self.tenant.id):
            scale = GradingScaleFactory(tenant=self.tenant)
            for order, (label, low, high) in enumerate(
                [("Fail", "0.00", "49.99"), ("Pass", "50.00", "100.00")]
            ):
                # Written in reverse so insertion order cannot pass for sort order.
                GradeBandFactory(
                    tenant=self.tenant,
                    grading_scale=scale,
                    label=label,
                    min_percent=low,
                    max_percent=high,
                    sort_order=1 - order,
                )

        response = self.client.get(f"{SCALES}/{scale.pk}/grade-bands")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual([band["label"] for band in response.json()["data"]], ["Pass", "Fail"])
        self.assertNotIn("pagination", response.json().get("meta", {}))

    def test_the_scale_list_costs_the_same_for_one_row_or_many(self) -> None:
        baseline = self.query_count(SCALES)
        with tenant_context(self.tenant.id):
            for _ in range(3):
                scale = GradingScaleFactory(tenant=self.tenant)
                GradeBandFactory(tenant=self.tenant, grading_scale=scale)

        with self.assertNumQueries(baseline):
            response = self.client.get(SCALES)

        self.assertEqual(len(response.json()["data"]), 4)
