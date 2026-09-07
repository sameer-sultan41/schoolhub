"""Cross-tenant access on every examinations endpoint.

testing-strategy.md §3 and AGENTS.md invariant 2: for each endpoint, a tenant-A
caller reaching for a tenant-B resource must get **404, never 403** — a 403
confirms the row exists, which is the leak the rule exists to prevent.

The acting user holds every key this module declares, `all`-scoped, and the flag
is on for both tenants, so a denial here can only come from tenant scoping.
Without that these would pass for the wrong reason the moment someone forgot a
permission.

Two endpoints fail differently from a plain detail lookup, and both are asserted
separately:

- **`POST /exams`** names its session and scale in the *body*. A foreign id
  fails to resolve through the serializer's tenant-scoped `PrimaryKeyRelatedField`
  rather than through a detail lookup, which is a **400** — the field genuinely
  does not validate. That is the intended answer and it leaks nothing: the
  message says the id is invalid, not that it belongs to someone else.
- **the nested band collection** resolves its scale from the path, so a foreign
  scale is a 404 on the collection URL itself, before any band is considered.
"""

from __future__ import annotations

from rest_framework import status

from apps.examinations.tests.base import ExaminationsAPITestCase
from apps.examinations.tests.factories import (
    AcademicSessionFactory,
    ClassFactory,
    ClassSubjectFactory,
    ExamFactory,
    ExamSubjectFactory,
    SubjectFactory,
    TenantFactory,
    complete_scale,
    enable_feature,
)
from core.tenancy.context import tenant_context

SCALES = "/api/v1/grading-scales"
EXAMS = "/api/v1/exams"
EXAM_SUBJECTS = "/api/v1/exam-subjects"


class ExaminationsCrossTenantTests(ExaminationsAPITestCase):
    """Builds a complete, self-consistent second tenant alongside the first."""

    def setUp(self) -> None:
        super().setUp()
        self.allow_everything()

        self.other_tenant = TenantFactory()
        enable_feature(self.other_tenant, "module.examinations")
        with tenant_context(self.other_tenant.id):
            session = AcademicSessionFactory(tenant=self.other_tenant, is_current=True)
            school_class = ClassFactory(tenant=self.other_tenant, level=8)
            subject = SubjectFactory(tenant=self.other_tenant)
            ClassSubjectFactory(
                tenant=self.other_tenant,
                academic_session=session,
                school_class=school_class,
                subject=subject,
            )
            self.foreign_scale = complete_scale(self.other_tenant, is_default=True)
            self.foreign_exam = ExamFactory(
                tenant=self.other_tenant,
                academic_session=session,
                grading_scale=self.foreign_scale,
            )
            self.foreign_exam_subject = ExamSubjectFactory(
                tenant=self.other_tenant,
                exam=self.foreign_exam,
                school_class=school_class,
                subject=subject,
            )
            self.foreign_band = self.foreign_scale.bands.first()
            self.foreign_session = session

    def assert404(self, response) -> None:
        self.assertEqual(
            response.status_code,
            status.HTTP_404_NOT_FOUND,
            f"expected 404, got {response.status_code}: {response.content!r}",
        )

    # --- grading scales ---------------------------------------------------

    def test_retrieving_a_foreign_scale_is_a_404(self) -> None:
        self.assert404(self.client.get(f"{SCALES}/{self.foreign_scale.pk}"))

    def test_patching_a_foreign_scale_is_a_404(self) -> None:
        self.assert404(
            self.client.patch(
                f"{SCALES}/{self.foreign_scale.pk}", {"name": "Mine now"}, format="json"
            )
        )

    def test_deleting_a_foreign_scale_is_a_404(self) -> None:
        self.assert404(self.client.delete(f"{SCALES}/{self.foreign_scale.pk}"))

    def test_setting_a_foreign_scale_as_default_is_a_404(self) -> None:
        """The one that would matter most: succeeding here would repoint this
        tenant's grading at another school's bands."""
        self.assert404(self.client.post(f"{SCALES}/{self.foreign_scale.pk}:set-default"))

    def test_listing_scales_never_shows_another_tenant_s(self) -> None:
        response = self.client.get(SCALES)

        ids = {row["id"] for row in response.json()["data"]}
        self.assertNotIn(str(self.foreign_scale.pk), ids)

    # --- grade bands ------------------------------------------------------

    def test_listing_bands_under_a_foreign_scale_is_a_404(self) -> None:
        self.assert404(self.client.get(f"{SCALES}/{self.foreign_scale.pk}/grade-bands"))

    def test_creating_a_band_under_a_foreign_scale_is_a_404(self) -> None:
        self.assert404(
            self.client.post(
                f"{SCALES}/{self.foreign_scale.pk}/grade-bands",
                {"label": "Z", "min_percent": "0.00", "max_percent": "100.00"},
                format="json",
            )
        )

    def test_retrieving_a_foreign_band_through_our_own_scale_is_a_404(self) -> None:
        """A band id from another tenant, addressed under a scale this caller
        does own — the shape that would slip past a naive `pk` lookup."""
        self.assert404(
            self.client.get(f"{SCALES}/{self.scale.pk}/grade-bands/{self.foreign_band.pk}")
        )

    def test_patching_a_foreign_band_is_a_404(self) -> None:
        self.assert404(
            self.client.patch(
                f"{SCALES}/{self.scale.pk}/grade-bands/{self.foreign_band.pk}",
                {"label": "Z"},
                format="json",
            )
        )

    def test_deleting_a_foreign_band_is_a_404(self) -> None:
        self.assert404(
            self.client.delete(f"{SCALES}/{self.scale.pk}/grade-bands/{self.foreign_band.pk}")
        )

    # --- exams ------------------------------------------------------------

    def test_retrieving_a_foreign_exam_is_a_404(self) -> None:
        self.assert404(self.client.get(f"{EXAMS}/{self.foreign_exam.pk}"))

    def test_patching_a_foreign_exam_is_a_404(self) -> None:
        self.assert404(
            self.client.patch(f"{EXAMS}/{self.foreign_exam.pk}", {"name": "X"}, format="json")
        )

    def test_deleting_a_foreign_exam_is_a_404(self) -> None:
        self.assert404(self.client.delete(f"{EXAMS}/{self.foreign_exam.pk}"))

    def test_listing_exams_never_shows_another_tenant_s(self) -> None:
        response = self.client.get(EXAMS)

        ids = {row["id"] for row in response.json()["data"]}
        self.assertNotIn(str(self.foreign_exam.pk), ids)

    def test_creating_an_exam_in_a_foreign_session_does_not_validate(self) -> None:
        """A 400, not a 404: the session id arrives in the body and fails the
        serializer's tenant-scoped queryset. The message says the id is invalid,
        never that it belongs to another school."""
        response = self.client.post(
            EXAMS,
            {
                "academic_session_id": str(self.foreign_session.pk),
                "name": "Cross-tenant midterm",
                "exam_type": "midterm",
                "grading_scale_id": str(self.scale.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertNotIn(str(self.other_tenant.pk), str(response.json()))

    def test_creating_an_exam_against_a_foreign_scale_does_not_validate(self) -> None:
        response = self.client.post(
            EXAMS,
            {
                "academic_session_id": str(self.session.pk),
                "name": "Borrowed grading",
                "exam_type": "midterm",
                "grading_scale_id": str(self.foreign_scale.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    # --- exam subjects ----------------------------------------------------

    def test_retrieving_a_foreign_exam_subject_is_a_404(self) -> None:
        self.assert404(self.client.get(f"{EXAM_SUBJECTS}/{self.foreign_exam_subject.pk}"))

    def test_patching_a_foreign_exam_subject_is_a_404(self) -> None:
        self.assert404(
            self.client.patch(
                f"{EXAM_SUBJECTS}/{self.foreign_exam_subject.pk}",
                {"max_marks": "1.00"},
                format="json",
            )
        )

    def test_deleting_a_foreign_exam_subject_is_a_404(self) -> None:
        self.assert404(self.client.delete(f"{EXAM_SUBJECTS}/{self.foreign_exam_subject.pk}"))

    def test_listing_exam_subjects_never_shows_another_tenant_s(self) -> None:
        response = self.client.get(EXAM_SUBJECTS)

        ids = {row["id"] for row in response.json()["data"]}
        self.assertNotIn(str(self.foreign_exam_subject.pk), ids)

    def test_configuring_a_subject_on_a_foreign_exam_does_not_validate(self) -> None:
        response = self.client.post(
            EXAM_SUBJECTS,
            {
                "exam_id": str(self.foreign_exam.pk),
                "class_id": str(self.school_class.pk),
                "subject_id": str(self.subject.pk),
                "max_marks": "100.00",
                "pass_marks": "40.00",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_foreign_band_is_invisible_even_by_direct_query(self) -> None:
        """Proof the manager, not the URL, is doing the narrowing: reading the
        foreign scale's bands under this tenant's context returns nothing."""
        from apps.examinations.models import GradeBand

        with tenant_context(self.tenant.id):
            leaked = GradeBand.objects.alive().filter(grading_scale=self.foreign_scale).count()

        self.assertEqual(leaked, 0)
