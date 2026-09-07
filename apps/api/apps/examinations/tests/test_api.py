"""The setup endpoints — §16's grading-scale, exam and exam-subject routes.

The cases that matter most here are the refusals. An exam that reaches marks
entry against an incomplete grading scale, or whose configuration is edited
after marks exist, produces results nobody can reproduce — and both are cheap
to allow by accident.
"""

from __future__ import annotations

import datetime
from decimal import Decimal

from rest_framework import status
from rest_framework.test import APIClient

from apps.examinations.models import ExamStatus, ScaleType
from apps.examinations.tests.base import ExaminationsAPITestCase
from apps.examinations.tests.factories import (
    AcademicSessionFactory,
    ClassFactory,
    ClassSubjectFactory,
    ExamFactory,
    GradeBandFactory,
    GradingScaleFactory,
    SubjectFactory,
    TenantFactory,
    TermFactory,
    UserFactory,
    authenticate,
    complete_scale,
    disable_feature,
    grant,
)
from apps.school_organization.models import SessionStatus
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

SCALES = "/api/v1/grading-scales"
EXAMS = "/api/v1/exams"
EXAM_SUBJECTS = "/api/v1/exam-subjects"


class GradingScaleEndpointTests(ExaminationsAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow_everything()

    def test_a_scale_is_created_and_lists_with_its_bands(self) -> None:
        """Bands are nested read-only: a client rendering a result needs the
        scale and its bands in one round trip."""
        response = self.client.get(f"{SCALES}?ordering=name")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        rows = response.json()["data"]
        scale = next(row for row in rows if row["id"] == str(self.scale.pk))
        self.assertEqual(len(scale["bands"]), 5)
        self.assertEqual({band["label"] for band in scale["bands"]}, {"A", "B", "C", "D", "F"})

    def test_a_gpa_scale_without_a_maximum_is_refused_with_a_named_field(self) -> None:
        response = self.client.post(
            SCALES, {"name": "Points", "scale_type": ScaleType.GPA}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("gpa_max", str(response.json()))

    def test_is_default_cannot_be_set_through_a_patch(self) -> None:
        """The column is read-only: making a scale the default is two writes,
        and a PATCH would 409 against whichever scale currently holds it."""
        with tenant_context(self.tenant.id):
            other = GradingScaleFactory(tenant=self.tenant, is_default=False)

        response = self.client.patch(f"{SCALES}/{other.pk}", {"is_default": True}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            other.refresh_from_db()
        self.assertFalse(other.is_default)

    def test_set_default_moves_the_flag_and_clears_the_previous_holder(self) -> None:
        with tenant_context(self.tenant.id):
            other = GradingScaleFactory(tenant=self.tenant, is_default=False)

        response = self.client.post(f"{SCALES}/{other.pk}:set-default")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            other.refresh_from_db()
            self.scale.refresh_from_db()
        self.assertTrue(other.is_default)
        self.assertFalse(self.scale.is_default)

    def test_set_default_is_idempotent(self) -> None:
        """Pressing the button twice is a retry, not a conflict."""
        response = self.client.post(f"{SCALES}/{self.scale.pk}:set-default")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            self.scale.refresh_from_db()
        self.assertTrue(self.scale.is_default)

    def test_reading_a_scale_needs_only_the_view_key(self) -> None:
        viewer = self._viewer("exams.grading-scale.view")

        response = viewer.get(SCALES)

        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_creating_a_scale_needs_the_create_key(self) -> None:
        viewer = self._viewer("exams.grading-scale.view")

        response = viewer.post(
            SCALES, {"name": "Sneaky", "scale_type": ScaleType.LETTER}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def _viewer(self, *keys: str):
        user = UserFactory(tenant=self.tenant)
        grant(user, *keys, scope=RecordScope.ALL)
        client = APIClient()
        authenticate(client, user)
        return client


class GradeBandEndpointTests(ExaminationsAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow_everything()
        with tenant_context(self.tenant.id):
            self.empty_scale = GradingScaleFactory(
                tenant=self.tenant, scale_type=ScaleType.LETTER, gpa_max=None
            )
        self.bands_url = f"{SCALES}/{self.empty_scale.pk}/grade-bands"

    def test_a_band_is_created_against_the_scale_in_the_url(self) -> None:
        response = self.client.post(
            self.bands_url,
            {"label": "P", "min_percent": "0.00", "max_percent": "100.00"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        self.assertEqual(response.json()["data"]["grading_scale_id"], str(self.empty_scale.pk))

    def test_a_band_is_accepted_even_though_the_scale_is_still_incomplete(self) -> None:
        """A scale is built one band at a time, and every intermediate state
        fails §11's coverage rule. Completeness is checked when an exam attaches
        the scale, not on each band write — otherwise a scale could never be
        built at all."""
        response = self.client.post(
            self.bands_url,
            {"label": "A", "min_percent": "80.00", "max_percent": "100.00"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())

    def test_a_band_whose_bounds_are_inverted_is_refused(self) -> None:
        response = self.client.post(
            self.bands_url,
            {"label": "X", "min_percent": "90.00", "max_percent": "80.00"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_bands_list_only_their_own_scale(self) -> None:
        with tenant_context(self.tenant.id):
            GradeBandFactory(
                tenant=self.tenant,
                grading_scale=self.empty_scale,
                label="P",
                min_percent=Decimal("0.00"),
                max_percent=Decimal("100.00"),
            )

        response = self.client.get(self.bands_url)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(len(response.json()["data"]), 1)

    def test_a_band_under_a_scale_from_another_tenant_is_a_404(self) -> None:
        """Never a 403 — that would confirm the scale exists."""
        other_tenant = TenantFactory()
        with tenant_context(other_tenant.id):
            foreign = complete_scale(other_tenant)

        response = self.client.get(f"{SCALES}/{foreign.pk}/grade-bands")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class ExamEndpointTests(ExaminationsAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow_everything()

    def _payload(self, **overrides) -> dict:
        payload = {
            "academic_session_id": str(self.session.pk),
            "name": "Term 1 Midterm",
            "exam_type": "midterm",
            "grading_scale_id": str(self.scale.pk),
        }
        payload.update(overrides)
        return payload

    def test_an_exam_is_created_as_a_draft(self) -> None:
        """§7.1 starts every exam at `draft`, and `status` is read-only — a
        client that could set it could skip the approval gate."""
        response = self.client.post(EXAMS, self._payload(status="published"), format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        self.assertEqual(response.json()["data"]["status"], ExamStatus.DRAFT)

    def test_an_exam_inherits_the_tenant_default_scale(self) -> None:
        """§5.1 does not make a caller name a scale on every exam."""
        payload = self._payload()
        del payload["grading_scale_id"]

        response = self.client.post(EXAMS, payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        self.assertEqual(response.json()["data"]["grading_scale_id"], str(self.scale.pk))

    def test_an_exam_against_an_incomplete_scale_is_refused_naming_the_gap(self) -> None:
        """The gate the whole grading design turns on. Refused here, on a form,
        rather than at result processing — where the same problem is a failed
        job over a whole school's marks."""
        with tenant_context(self.tenant.id):
            gapped = GradingScaleFactory(
                tenant=self.tenant, scale_type=ScaleType.LETTER, gpa_max=None
            )
            GradeBandFactory(
                tenant=self.tenant,
                grading_scale=gapped,
                label="P",
                min_percent=Decimal("50.00"),
                max_percent=Decimal("100.00"),
            )

        response = self.client.post(
            EXAMS, self._payload(grading_scale_id=str(gapped.pk)), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("must start at 0", str(response.json()))

    def test_an_exam_with_no_dates_is_allowed(self) -> None:
        response = self.client.post(EXAMS, self._payload(), format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        self.assertIsNone(response.json()["data"]["starts_on"])

    def test_one_date_alone_is_refused(self) -> None:
        response = self.client.post(
            EXAMS, self._payload(starts_on=str(self.term.start_date)), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_dates_outside_the_named_term_are_refused(self) -> None:
        outside = self.term.end_date + datetime.timedelta(days=30)

        response = self.client.post(
            EXAMS,
            self._payload(
                term_id=str(self.term.pk),
                starts_on=str(outside),
                ends_on=str(outside + datetime.timedelta(days=2)),
            ),
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("outside", str(response.json()))

    def test_a_term_from_another_session_is_refused(self) -> None:
        """Both ids arrive independently, so nothing else stops an exam claiming
        last year's Term 1 inside this year's session."""
        with tenant_context(self.tenant.id):
            other_session = AcademicSessionFactory(tenant=self.tenant)
            foreign_term = TermFactory(
                tenant=self.tenant, academic_session=other_session, sequence=1
            )

        response = self.client.post(
            EXAMS, self._payload(term_id=str(foreign_term.pk)), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("different academic session", str(response.json()))

    def test_an_exam_in_a_closed_session_is_refused(self) -> None:
        with tenant_context(self.tenant.id):
            self.session.is_current = False
            self.session.status = SessionStatus.CLOSED
            self.session.save(update_fields=["is_current", "status"])

        response = self.client.post(EXAMS, self._payload(), format="json")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("no longer accepts changes", str(response.json()))

    def test_editing_an_exam_past_marks_entry_is_a_conflict(self) -> None:
        """§7.1 freezes configuration once marks exist: editing `max_marks`
        afterwards would rescale results already entered against the old
        maximum, and nothing in the data would record that it happened."""
        with tenant_context(self.tenant.id):
            exam = ExamFactory(
                tenant=self.tenant,
                academic_session=self.session,
                grading_scale=self.scale,
                status=ExamStatus.MARKS_ENTRY,
            )

        response = self.client.patch(f"{EXAMS}/{exam.pk}", {"name": "Renamed"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_only_a_draft_exam_can_be_deleted(self) -> None:
        with tenant_context(self.tenant.id):
            exam = ExamFactory(
                tenant=self.tenant,
                academic_session=self.session,
                grading_scale=self.scale,
                status=ExamStatus.SCHEDULED,
            )

        response = self.client.delete(f"{EXAMS}/{exam.pk}")

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertIn("archive it instead", str(response.json()))

    def test_a_draft_exam_is_soft_deleted(self) -> None:
        with tenant_context(self.tenant.id):
            exam = ExamFactory(
                tenant=self.tenant, academic_session=self.session, grading_scale=self.scale
            )

        response = self.client.delete(f"{EXAMS}/{exam.pk}")

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        with tenant_context(self.tenant.id):
            exam.refresh_from_db()
        self.assertIsNotNone(exam.deleted_at)

    def test_exams_filter_by_status_session_and_type(self) -> None:
        with tenant_context(self.tenant.id):
            ExamFactory(
                tenant=self.tenant,
                academic_session=self.session,
                grading_scale=self.scale,
                status=ExamStatus.PUBLISHED,
            )
            ExamFactory(tenant=self.tenant, academic_session=self.session, grading_scale=self.scale)

        published = self.client.get(f"{EXAMS}?status={ExamStatus.PUBLISHED}")
        by_session = self.client.get(f"{EXAMS}?academic_session_id={self.session.pk}")

        self.assertEqual(len(published.json()["data"]), 1)
        self.assertEqual(len(by_session.json()["data"]), 2)


class ExamSubjectEndpointTests(ExaminationsAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow_everything()
        with tenant_context(self.tenant.id):
            self.exam = ExamFactory(
                tenant=self.tenant, academic_session=self.session, grading_scale=self.scale
            )

    def _payload(self, **overrides) -> dict:
        payload = {
            "exam_id": str(self.exam.pk),
            "class_id": str(self.school_class.pk),
            "subject_id": str(self.subject.pk),
            "max_marks": "100.00",
            "pass_marks": "40.00",
        }
        payload.update(overrides)
        return payload

    def test_a_subject_configuration_is_created(self) -> None:
        response = self.client.post(EXAM_SUBJECTS, self._payload(), format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())

    def test_a_subject_outside_the_class_curriculum_is_refused(self) -> None:
        """The same rule academics enforces for a teacher allocation, keyed on
        the class: an exam is configured per class, and every section of Grade 8
        sits the same paper."""
        with tenant_context(self.tenant.id):
            stranger = SubjectFactory(tenant=self.tenant)

        response = self.client.post(
            EXAM_SUBJECTS, self._payload(subject_id=str(stranger.pk)), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("not in the curriculum", str(response.json()))

    def test_pass_marks_above_the_maximum_are_refused(self) -> None:
        response = self.client.post(
            EXAM_SUBJECTS, self._payload(pass_marks="120.00"), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_practical_component_without_a_maximum_is_refused(self) -> None:
        response = self.client.post(EXAM_SUBJECTS, self._payload(has_practical=True), format="json")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("practical maximum", str(response.json()))

    def test_marks_locked_at_cannot_be_set_through_the_api(self) -> None:
        """§5.4 makes locking a permission-gated, audited action. A client that
        could PATCH the column could reopen a locked register with no trace."""
        response = self.client.post(
            EXAM_SUBJECTS,
            self._payload(marks_locked_at="2026-01-01T00:00:00Z"),
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        self.assertIsNone(response.json()["data"]["marks_locked_at"])

    def test_configuring_a_subject_on_an_exam_past_marks_entry_is_a_conflict(self) -> None:
        with tenant_context(self.tenant.id):
            self.exam.status = ExamStatus.PROCESSING
            self.exam.save(update_fields=["status"])

        response = self.client.post(EXAM_SUBJECTS, self._payload(), format="json")

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_the_same_subject_in_two_classes_is_two_configurations(self) -> None:
        with tenant_context(self.tenant.id):
            other_class = ClassFactory(tenant=self.tenant, level=9)
            ClassSubjectFactory(
                tenant=self.tenant,
                academic_session=self.session,
                school_class=other_class,
                subject=self.subject,
            )

        first = self.client.post(EXAM_SUBJECTS, self._payload(), format="json")
        second = self.client.post(
            EXAM_SUBJECTS,
            self._payload(class_id=str(other_class.pk), max_marks="50.00", pass_marks="20.00"),
            format="json",
        )

        self.assertEqual(first.status_code, status.HTTP_201_CREATED, first.json())
        self.assertEqual(second.status_code, status.HTTP_201_CREATED, second.json())

    def test_exam_subjects_filter_by_exam(self) -> None:
        self.client.post(EXAM_SUBJECTS, self._payload(), format="json")

        response = self.client.get(f"{EXAM_SUBJECTS}?exam_id={self.exam.pk}")

        self.assertEqual(len(response.json()["data"]), 1)


class FeatureFlagTests(ExaminationsAPITestCase):
    def test_every_route_is_behind_the_module_flag(self) -> None:
        """A module disabled for a tenant answers 403 `module_disabled`, not
        404: the tenant's admin needs to know the module exists and is off."""
        self.allow_everything()
        disable_feature(self.tenant, "module.examinations")

        for url in (SCALES, EXAMS, EXAM_SUBJECTS):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, status.HTTP_403_FORBIDDEN)
