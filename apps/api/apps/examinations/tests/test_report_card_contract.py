"""The report-card wire contract: names and figures on the row, the `section_id`
filter, flat query counts, the per-field remarks split (ADR-0027's amendment),
and the record scope on the exam-addressed actions (L46)."""

from __future__ import annotations

from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework import status
from rest_framework.test import APIClient

from apps.examinations import services
from apps.examinations.models import ReportCard, ReportCardStatus, Result
from apps.examinations.tests.factories import (
    CampusFactory,
    ReportCardFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.examinations.tests.test_report_cards import PublishedResultsTestCase
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

REPORT_CARDS = "/api/v1/report-cards"


class ReportCardsTestCase(PublishedResultsTestCase):
    """Published results and one draft card per student."""

    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.cards = {}
            for result in Result.objects.alive().filter(exam=self.exam):
                self.cards[result.student_id] = services.upsert_report_card(
                    exam=self.exam, result=result, summary=None, actor_id=self.user.pk
                )
        self.card = self.cards[self.students[0].pk]

    def client_with(self, *keys: str, scope: str = RecordScope.ALL) -> APIClient:
        with tenant_context(self.tenant.id):
            user = UserFactory(tenant=self.tenant)
        grant(user, *keys, scope=scope)
        client = APIClient()
        authenticate(client, user)
        return client


class ReportCardRowTests(ReportCardsTestCase):
    def test_a_card_carries_its_student_section_and_figures(self) -> None:
        with tenant_context(self.tenant.id):
            result = Result.objects.alive().select_related("grade_band").get(pk=self.card.result_id)

        for url in (f"{REPORT_CARDS}/{self.card.pk}", REPORT_CARDS):
            with self.subTest(url=url):
                response = self.client.get(url, {"student_id": str(self.students[0].pk)})
                self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
                data = response.json()["data"]
                row = data[0] if isinstance(data, list) else data
                self.assertEqual(row["student_name"], self.students[0].full_name)
                self.assertEqual(row["admission_number"], self.students[0].admission_number)
                self.assertEqual(row["section_id"], str(self.section.pk))
                self.assertEqual(row["section_name"], self.section.name)
                self.assertEqual(row["percentage"], str(result.percentage))
                self.assertEqual(row["grade"], result.grade_band.label)

    def test_a_term_card_has_no_section_or_figures(self) -> None:
        with tenant_context(self.tenant.id):
            term_card = ReportCardFactory(
                tenant=self.tenant, term=self.term, student=self.students[0]
            )

        response = self.client.get(f"{REPORT_CARDS}/{term_card.pk}")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        data = response.json()["data"]
        for field in ("section_id", "section_name", "percentage", "grade"):
            self.assertIsNone(data[field], field)

    def test_the_section_filter_reads_the_card_s_result(self) -> None:
        with tenant_context(self.tenant.id):
            ReportCardFactory(tenant=self.tenant, term=self.term, student=self.students[0])

        mine = self.client.get(REPORT_CARDS, {"section_id": str(self.section.pk)})
        other = self.client.get(REPORT_CARDS, {"section_id": str(self.other_section.pk)})

        self.assertEqual(
            {row["id"] for row in mine.json()["data"]},
            {str(card.pk) for card in self.cards.values()},
        )
        self.assertEqual(other.json()["data"], [])

    def test_the_list_is_a_flat_number_of_queries(self) -> None:
        self.client.get(REPORT_CARDS)  # warm the permission and scope caches

        with CaptureQueriesContext(connection) as one:
            single = self.client.get(REPORT_CARDS, {"student_id": str(self.students[0].pk)})
        with CaptureQueriesContext(connection) as many:
            every = self.client.get(REPORT_CARDS)

        self.assertEqual(len(single.json()["data"]), 1)
        self.assertEqual(len(every.json()["data"]), 3)
        self.assertEqual(len(many.captured_queries), len(one.captured_queries))


class RemarksSplitTests(ReportCardsTestCase):
    """`class_teacher_remarks` needs `.create`, `principal_remarks` needs `.publish`."""

    def patch(self, client: APIClient, body: dict):
        return client.patch(f"{REPORT_CARDS}/{self.card.pk}", body, format="json")

    def stored(self) -> ReportCard:
        with tenant_context(self.tenant.id):
            return ReportCard.objects.get(pk=self.card.pk)

    def test_the_class_teacher_key_writes_class_teacher_remarks(self) -> None:
        client = self.client_with("exams.report-card.view", "exams.report-card.create")

        response = self.patch(client, {"class_teacher_remarks": "Steady progress."})

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(self.stored().class_teacher_remarks, "Steady progress.")

    def test_the_class_teacher_key_cannot_write_principal_remarks(self) -> None:
        client = self.client_with("exams.report-card.view", "exams.report-card.create")

        response = self.patch(client, {"principal_remarks": "Promoted."})

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.json()["error"]["details"][0]["field"], "principal_remarks")
        self.assertIsNone(self.stored().principal_remarks)

    def test_the_principal_key_writes_principal_remarks(self) -> None:
        client = self.client_with("exams.report-card.view", "exams.report-card.publish")

        response = self.patch(client, {"principal_remarks": "Promoted."})

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(self.stored().principal_remarks, "Promoted.")

    def test_the_principal_key_cannot_write_class_teacher_remarks(self) -> None:
        client = self.client_with("exams.report-card.view", "exams.report-card.publish")

        response = self.patch(client, {"class_teacher_remarks": "Mine now."})

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.json()["error"]["details"][0]["field"], "class_teacher_remarks")
        self.assertIsNone(self.stored().class_teacher_remarks)

    def test_one_refused_field_refuses_the_whole_patch(self) -> None:
        client = self.client_with("exams.report-card.view", "exams.report-card.create")

        response = self.patch(
            client, {"class_teacher_remarks": "Steady.", "principal_remarks": "Promoted."}
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIsNone(self.stored().class_teacher_remarks)

    def test_holding_both_keys_writes_both(self) -> None:
        client = self.client_with(
            "exams.report-card.view", "exams.report-card.create", "exams.report-card.publish"
        )

        response = self.patch(
            client, {"class_teacher_remarks": "Steady.", "principal_remarks": "Promoted."}
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        card = self.stored()
        self.assertEqual(card.class_teacher_remarks, "Steady.")
        self.assertEqual(card.principal_remarks, "Promoted.")

    def test_neither_key_is_refused_before_any_field_is_read(self) -> None:
        client = self.client_with("exams.report-card.view")

        response = self.patch(client, {"class_teacher_remarks": "Steady."})

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_the_principal_key_held_only_for_another_campus_cannot_write_principal_remarks(
        self,
    ) -> None:
        """L36: a field's key is checked for this card's campus, not held anywhere.

        The read and class-teacher keys at `all` reach the card; `.publish` covers
        another campus only, so `principal_remarks` is refused and nothing is written.
        """
        with tenant_context(self.tenant.id):
            far_campus = CampusFactory(tenant=self.tenant)
            near = UserFactory(tenant=self.tenant)
            far = UserFactory(tenant=self.tenant)
        for user, campus_id in ((near, self.students[0].campus_id), (far, far_campus.pk)):
            grant(user, "exams.report-card.view", "exams.report-card.create", scope=RecordScope.ALL)
            grant(user, "exams.report-card.publish", scope=RecordScope.CAMPUS, scope_ref=campus_id)
        far_client, near_client = APIClient(), APIClient()
        authenticate(far_client, far)
        authenticate(near_client, near)

        refused = self.patch(far_client, {"principal_remarks": "Promoted."})

        self.assertEqual(refused.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(refused.json()["error"]["details"][0]["field"], "principal_remarks")
        self.assertIsNone(self.stored().principal_remarks)
        # The same grant on the card's own campus writes it.
        written = self.patch(near_client, {"principal_remarks": "Promoted."})
        self.assertEqual(written.status_code, status.HTTP_200_OK, written.json())
        self.assertEqual(self.stored().principal_remarks, "Promoted.")

    def test_an_out_of_scope_card_is_a_404_not_a_field_403(self) -> None:
        """The field check runs after the scoped lookup, so it never confirms a card exists."""
        client = self.client_with(
            "exams.report-card.view", "exams.report-card.create", scope=RecordScope.ASSIGNED
        )

        response = self.patch(client, {"principal_remarks": "Promoted."})

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class ReportCardActionScopeTests(ReportCardsTestCase):
    """L46: generation and publishing resolve the exam through the record scope."""

    KEYS = ("exams.report-card.view", "exams.report-card.create", "exams.report-card.publish")

    def actions(self) -> list[str]:
        base = f"/api/v1/exams/{self.exam.pk}"
        return [f"{base}:generate-report-cards", f"{base}:publish-report-cards"]

    def test_an_exam_outside_the_caller_s_scope_is_a_404(self) -> None:
        outsider = self.client_with(*self.KEYS, scope=RecordScope.ASSIGNED)

        for url in self.actions():
            with self.subTest(url=url):
                self.assertEqual(outsider.post(url).status_code, status.HTTP_404_NOT_FOUND)

    def test_an_all_publish_role_does_not_reach_an_exam_the_view_role_hides(self) -> None:
        """L36: both report-card actions reach the exam under the read key, then their own.

        `exams.report-card.view` on an `assigned` role that teaches nothing and
        `.create`/`.publish` at `all`: a 404, as for a caller with neither.
        """
        with tenant_context(self.tenant.id):
            mixed = UserFactory(tenant=self.tenant)
        grant(mixed, "exams.report-card.view", scope=RecordScope.ASSIGNED)
        grant(mixed, "exams.report-card.create", "exams.report-card.publish", scope=RecordScope.ALL)
        client = APIClient()
        authenticate(client, mixed)

        for url in self.actions():
            with self.subTest(url=url):
                self.assertEqual(client.post(url).status_code, status.HTTP_404_NOT_FOUND)

    def test_the_class_teacher_reaches_both_actions(self) -> None:
        grant(self.teacher_user, *self.KEYS, scope=RecordScope.ASSIGNED)
        client = APIClient()
        authenticate(client, self.teacher_user)

        # Generation queues (202); publishing finds nothing rendered (409).
        for url in self.actions():
            with self.subTest(url=url):
                self.assertNotEqual(client.post(url).status_code, status.HTTP_404_NOT_FOUND)

    def test_publish_answers_its_count_and_the_ids_it_moved(self) -> None:
        from apps.examinations import uploads
        from core.files.services import create_ready_file

        with tenant_context(self.tenant.id):
            self.card.file = create_ready_file(
                tenant_id=self.tenant.pk,
                purpose=uploads.REPORT_CARD.key,
                original_name="card.pdf",
                mime_type="application/pdf",
                data=b"%PDF-stub",
                actor_id=self.user.pk,
            )
            self.card.status = ReportCardStatus.GENERATED
            self.card.save(update_fields=["file", "status"])

        response = self.client.post(f"/api/v1/exams/{self.exam.pk}:publish-report-cards")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(
            response.json()["data"], {"published": 1, "published_ids": [str(self.card.pk)]}
        )
