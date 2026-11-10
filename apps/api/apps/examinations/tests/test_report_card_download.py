"""`POST /report-cards/{id}:download` — ADR-0021's resource-scoped link.

The admit card's `:download` shape: the view key, the record scope through
`get_object()`, published-only for a student or guardian, and a 404 for a card
with no usable document.
"""

from __future__ import annotations

from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework import status
from rest_framework.test import APIClient

from apps.examinations import uploads
from apps.examinations.models import ReportCard, ReportCardStatus
from apps.examinations.tests.factories import UserFactory, authenticate, grant
from apps.examinations.tests.test_report_card_contract import ReportCardsTestCase
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

REPORT_CARDS = "/api/v1/report-cards"


class ReportCardDownloadTests(ReportCardsTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.mine = self.card
        self.theirs = self.cards[self.students[1].pk]
        for card in (self.mine, self.theirs):
            self.render(card, ReportCardStatus.PUBLISHED)

    def render(self, card: ReportCard, card_status: str) -> None:
        """What the render job (and a publish) leave behind: a ready PDF on the card."""
        from core.files.services import create_ready_file

        with tenant_context(self.tenant.id):
            card.file = create_ready_file(
                tenant_id=self.tenant.pk,
                purpose=uploads.REPORT_CARD.key,
                original_name="report-card.pdf",
                mime_type="application/pdf",
                data=b"%PDF-stub",
                actor_id=self.user.pk,
            )
            card.status = card_status
            card.save(update_fields=["file", "status"])

    def download(self, card: ReportCard, client: APIClient | None = None):
        return (client or self.client).post(f"{REPORT_CARDS}/{card.pk}:download")

    def student_client(self) -> APIClient:
        """`self.students[0]`'s own portal login, `own`-scoped."""
        with tenant_context(self.tenant.id):
            student_user = UserFactory(tenant=self.tenant)
            self.students[0].user_id = student_user.pk
            self.students[0].save(update_fields=["user_id"])
        grant(
            student_user,
            "exams.report-card.view",
            scope=RecordScope.OWN,
            is_restricted_principal=True,
        )
        client = APIClient()
        authenticate(client, student_user)
        return client

    def test_staff_get_a_signed_link(self) -> None:
        response = self.download(self.mine)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertTrue(response.json()["data"]["download_url"])

    def test_staff_may_download_a_generated_card_before_it_is_published(self) -> None:
        with tenant_context(self.tenant.id):
            ReportCard.objects.filter(pk=self.mine.pk).update(status=ReportCardStatus.GENERATED)

        self.assertEqual(self.download(self.mine).status_code, status.HTTP_200_OK)

    def test_a_student_downloads_their_own_published_card(self) -> None:
        response = self.download(self.mine, self.student_client())

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertTrue(response.json()["data"]["download_url"])

    def test_an_unpublished_card_is_a_404_to_its_student(self) -> None:
        """Rendered, but not released: §5.7 makes publishing the separate act."""
        with tenant_context(self.tenant.id):
            ReportCard.objects.filter(pk=self.mine.pk).update(status=ReportCardStatus.GENERATED)

        response = self.download(self.mine, self.student_client())

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_another_student_s_card_is_a_404(self) -> None:
        response = self.download(self.theirs, self.student_client())

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_an_unrendered_card_is_a_404(self) -> None:
        draft = self.cards[self.students[2].pk]

        self.assertEqual(self.download(draft).status_code, status.HTTP_404_NOT_FOUND)

    def test_a_retired_file_is_a_404(self) -> None:
        from django.utils import timezone

        from core.files.models import File

        with tenant_context(self.tenant.id):
            File.objects.filter(pk=self.mine.file_id).update(deleted_at=timezone.now())

        self.assertEqual(self.download(self.mine).status_code, status.HTTP_404_NOT_FOUND)

    def test_an_assigned_reader_outside_the_card_s_section_gets_a_404(self) -> None:
        with tenant_context(self.tenant.id):
            outsider = UserFactory(tenant=self.tenant)
        grant(outsider, "exams.report-card.view", scope=RecordScope.ASSIGNED)
        client = APIClient()
        authenticate(client, outsider)

        self.assertEqual(self.download(self.mine, client).status_code, 404)

    def test_the_class_teacher_downloads_their_section_s_card(self) -> None:
        grant(self.teacher_user, "exams.report-card.view", scope=RecordScope.ASSIGNED)
        client = APIClient()
        authenticate(client, self.teacher_user)

        self.assertEqual(self.download(self.mine, client).status_code, status.HTTP_200_OK)

    def test_downloading_needs_the_report_card_view_key(self) -> None:
        with tenant_context(self.tenant.id):
            user = UserFactory(tenant=self.tenant)
        grant(user, "exams.result.view", scope=RecordScope.ALL)
        client = APIClient()
        authenticate(client, user)

        self.assertEqual(self.download(self.mine, client).status_code, 403)

    def test_a_download_costs_a_fixed_number_of_queries(self) -> None:
        """One card with its file joined, and no student or result join."""
        self.download(self.mine)  # warm the per-user permission caches
        with CaptureQueriesContext(connection) as baseline:
            self.assertEqual(self.download(self.mine).status_code, status.HTTP_200_OK)

        with self.assertNumQueries(len(baseline)):
            self.download(self.theirs)
