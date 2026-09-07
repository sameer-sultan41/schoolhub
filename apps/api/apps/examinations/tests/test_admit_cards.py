"""§5.3's admit cards — constraints, the idempotent batch, and revocation.

The batch is where the interesting behaviour is. §8's exam-staff journey is
"issues admit cards in one batch", which in practice means pressing the button
again after the roll changes — so a re-run is the normal case rather than an
error, and the two things it must *not* do are duplicate a card or quietly
reinstate one somebody revoked.
"""

from __future__ import annotations

from django.db import IntegrityError, transaction
from rest_framework import status

from apps.examinations import services
from apps.examinations.models import AdmitCard, AdmitCardStatus, ExamStatus
from apps.examinations.tests.base import ExaminationsAPITestCase
from apps.examinations.tests.factories import (
    AdmitCardFactory,
    ExamFactory,
    ExamScheduleFactory,
    ExamSubjectFactory,
    RoomFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    exam_week,
)
from core.tenancy.context import tenant_context

ADMIT_CARDS = "/api/v1/admit-cards"


class AdmitCardTestCase(ExaminationsAPITestCase):
    """An exam with a published schedule — the state cards are issuable from."""

    def setUp(self) -> None:
        super().setUp()
        self.allow_everything()
        with tenant_context(self.tenant.id):
            self.exam = ExamFactory(
                tenant=self.tenant,
                academic_session=self.session,
                grading_scale=self.scale,
                status=ExamStatus.SCHEDULED,
            )
            self.exam_subject = ExamSubjectFactory(
                tenant=self.tenant,
                exam=self.exam,
                school_class=self.school_class,
                subject=self.subject,
            )
            self.room = RoomFactory(tenant=self.tenant, campus=self.campus, capacity=40)
        self.day = exam_week(self.tenant, self.exam)
        with tenant_context(self.tenant.id):
            self.sitting = ExamScheduleFactory(
                tenant=self.tenant,
                exam_subject=self.exam_subject,
                section=self.section,
                exam_date=self.day,
                room=self.room,
                instructions="Bring a transparent pencil case. No phones.",
            )


class AdmitCardConstraintTests(AdmitCardTestCase):
    def test_one_card_per_student_per_exam(self) -> None:
        with tenant_context(self.tenant.id):
            AdmitCardFactory(tenant=self.tenant, exam=self.exam, student=self.students[0])

        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            self.assertRaises(IntegrityError),
        ):
            AdmitCardFactory(tenant=self.tenant, exam=self.exam, student=self.students[0])

    def test_two_students_cannot_share_a_card_number(self) -> None:
        """The number is what an invigilator checks against a list, so a
        collision is a spoiled sitting rather than a cosmetic problem."""
        with tenant_context(self.tenant.id):
            AdmitCardFactory(
                tenant=self.tenant,
                exam=self.exam,
                student=self.students[0],
                admit_card_no="DUP-1",
            )

        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            self.assertRaises(IntegrityError),
        ):
            AdmitCardFactory(
                tenant=self.tenant,
                exam=self.exam,
                student=self.students[1],
                admit_card_no="DUP-1",
            )

    def test_a_revocation_without_a_reason_is_refused(self) -> None:
        """A revocation nobody can explain is the one a parent will ask about."""
        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            self.assertRaises(IntegrityError),
        ):
            AdmitCardFactory(
                tenant=self.tenant,
                exam=self.exam,
                student=self.students[0],
                status=AdmitCardStatus.REVOKED,
                revoked_reason=None,
            )


class IssueBatchTests(AdmitCardTestCase):
    def test_a_batch_issues_one_card_per_scheduled_student(self) -> None:
        with tenant_context(self.tenant.id):
            outcome = services.issue_admit_cards(exam=self.exam, actor_id=self.user.pk)

        self.assertEqual(outcome["issued"], 3)
        with tenant_context(self.tenant.id):
            self.assertEqual(AdmitCard.objects.alive().filter(exam=self.exam).count(), 3)

    def test_a_student_in_an_unscheduled_section_gets_no_card(self) -> None:
        """Resolved from the sections the exam is actually scheduled for, not
        from every student in the school: a school runs Grade 8's midterm
        without issuing Grade 3 a card."""
        with tenant_context(self.tenant.id):
            stranger = StudentFactory(tenant=self.tenant, campus=self.campus)
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=stranger,
                academic_session=self.session,
                school_class=self.school_class,
                section=self.other_section,
            )
            outcome = services.issue_admit_cards(exam=self.exam, actor_id=self.user.pk)
            holders = set(
                AdmitCard.objects.alive()
                .filter(exam=self.exam)
                .values_list("student_id", flat=True)
            )

        self.assertEqual(outcome["issued"], 3)
        self.assertNotIn(stranger.pk, holders)

    def test_a_re_run_tops_up_rather_than_duplicating(self) -> None:
        """The normal case, not an error: a student admitted after the first
        batch needs a card."""
        with tenant_context(self.tenant.id):
            services.issue_admit_cards(exam=self.exam, actor_id=self.user.pk)
            late_admission = StudentFactory(tenant=self.tenant, campus=self.campus)
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=late_admission,
                academic_session=self.session,
                school_class=self.school_class,
                section=self.section,
            )
            second = services.issue_admit_cards(exam=self.exam, actor_id=self.user.pk)

        self.assertEqual(second["issued"], 1)
        self.assertEqual(second["already_issued"], 3)
        with tenant_context(self.tenant.id):
            self.assertEqual(AdmitCard.objects.alive().filter(exam=self.exam).count(), 4)

    def test_a_re_run_does_not_reinstate_a_revoked_card(self) -> None:
        """Revocation is a decision someone made. A top-up run silently undoing
        it would reverse that decision without anyone asking."""
        with tenant_context(self.tenant.id):
            services.issue_admit_cards(exam=self.exam, actor_id=self.user.pk)
            card = AdmitCard.objects.alive().filter(exam=self.exam).first()
            services.revoke_admit_card(card=card, reason="Fees outstanding", actor_id=self.user.pk)
            services.issue_admit_cards(exam=self.exam, actor_id=self.user.pk)
            card.refresh_from_db()

        self.assertEqual(card.status, AdmitCardStatus.REVOKED)

    def test_a_draft_exam_cannot_issue_cards(self) -> None:
        """A card carries its own sitting dates, so issuing before the schedule
        is published prints a document that is about to change."""
        with tenant_context(self.tenant.id):
            self.exam.status = ExamStatus.DRAFT
            self.exam.save(update_fields=["status"])

        response = self.client.post(f"/api/v1/exams/{self.exam.pk}:issue-admit-cards")

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertIn("Publish the schedule first", str(response.json()))

    def test_card_numbers_are_derived_from_the_exam_and_admission_number(self) -> None:
        """Derived rather than random so a lost card can be re-derived, and
        prefixed by the exam so two exams never collide for one student."""
        number = services.admit_card_number(
            exam=self.exam, admission_number=self.students[0].admission_number
        )

        self.assertTrue(number.startswith(str(self.exam.pk)[:8].upper()))
        self.assertIn(self.students[0].admission_number, number)


class IssueEndpointTests(AdmitCardTestCase):
    def test_issue_returns_202_and_a_job(self) -> None:
        """§16 — a hall's worth of PDFs is not work an exam clerk holds a
        request open for."""
        response = self.client.post(f"/api/v1/exams/{self.exam.pk}:issue-admit-cards")

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        self.assertIn("job_id", response.json()["data"])

    def test_the_rows_exist_before_the_job_runs(self) -> None:
        """Rows synchronously, documents deferred: the caller learns immediately
        how many cards the run added."""
        self.client.post(f"/api/v1/exams/{self.exam.pk}:issue-admit-cards")

        with tenant_context(self.tenant.id):
            self.assertEqual(AdmitCard.objects.alive().filter(exam=self.exam).count(), 3)

    def test_an_idempotency_key_replays_rather_than_re_rendering(self) -> None:
        """A clerk's double-click on a batch action should replay the first
        answer, not start a second render of three hundred documents."""
        first = self.client.post(
            f"/api/v1/exams/{self.exam.pk}:issue-admit-cards",
            **{"HTTP_IDEMPOTENCY_KEY": "batch-1"},
        )
        second = self.client.post(
            f"/api/v1/exams/{self.exam.pk}:issue-admit-cards",
            **{"HTTP_IDEMPOTENCY_KEY": "batch-1"},
        )

        self.assertEqual(first.status_code, status.HTTP_202_ACCEPTED, first.json())
        self.assertEqual(second.json()["data"]["job_id"], first.json()["data"]["job_id"])

    def test_issuing_needs_the_issue_key_not_the_view_key(self) -> None:
        from rest_framework.test import APIClient

        from apps.examinations.tests.factories import UserFactory, authenticate, grant
        from core.rbac.models import RecordScope

        viewer = UserFactory(tenant=self.tenant)
        grant(viewer, "exams.admit-card.view", scope=RecordScope.ALL)
        client = APIClient()
        authenticate(client, viewer)

        response = client.post(f"/api/v1/exams/{self.exam.pk}:issue-admit-cards")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class RevokeTests(AdmitCardTestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            services.issue_admit_cards(exam=self.exam, actor_id=self.user.pk)
            self.card = AdmitCard.objects.alive().filter(exam=self.exam).first()

    def test_revoking_records_the_reason(self) -> None:
        response = self.client.post(
            f"{ADMIT_CARDS}/{self.card.pk}:revoke",
            {"reason": "Fee clearance outstanding"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            self.card.refresh_from_db()
        self.assertEqual(self.card.status, AdmitCardStatus.REVOKED)
        self.assertEqual(self.card.revoked_reason, "Fee clearance outstanding")

    def test_revoking_without_a_reason_is_refused(self) -> None:
        response = self.client.post(f"{ADMIT_CARDS}/{self.card.pk}:revoke", {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_revoking_twice_is_a_conflict(self) -> None:
        self.client.post(f"{ADMIT_CARDS}/{self.card.pk}:revoke", {"reason": "Fees"}, format="json")

        response = self.client.post(
            f"{ADMIT_CARDS}/{self.card.pk}:revoke", {"reason": "Fees again"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)


class AdmitCardRecordScopeTests(AdmitCardTestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            services.issue_admit_cards(exam=self.exam, actor_id=self.user.pk)

    def test_a_student_sees_only_their_own_card(self) -> None:
        from rest_framework.test import APIClient

        from apps.examinations.tests.factories import UserFactory, authenticate, grant
        from core.rbac.models import RecordScope

        with tenant_context(self.tenant.id):
            student_user = UserFactory(tenant=self.tenant)
            self.students[0].user_id = student_user.pk
            self.students[0].save(update_fields=["user_id"])
            mine = AdmitCard.objects.alive().get(exam=self.exam, student=self.students[0])

        grant(
            student_user,
            "exams.admit-card.view",
            scope=RecordScope.OWN,
            is_restricted_principal=True,
        )
        client = APIClient()
        authenticate(client, student_user)

        response = client.get(ADMIT_CARDS)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual({row["id"] for row in response.json()["data"]}, {str(mine.pk)})

    def test_a_restricted_principal_cannot_revoke(self) -> None:
        """The portal read exemption is per-action. A guardian holding the issue
        key would otherwise be able to withdraw another child's card."""
        from rest_framework.test import APIClient

        from apps.examinations.tests.factories import UserFactory, authenticate, grant
        from core.rbac.models import RecordScope

        with tenant_context(self.tenant.id):
            guardian_user = UserFactory(tenant=self.tenant)
            card = AdmitCard.objects.alive().filter(exam=self.exam).first()
        grant(
            guardian_user,
            "exams.admit-card.view",
            "exams.admit-card.issue",
            scope=RecordScope.ALL,
            is_restricted_principal=True,
        )
        client = APIClient()
        authenticate(client, guardian_user)

        response = client.post(
            f"{ADMIT_CARDS}/{card.pk}:revoke", {"reason": "mine now"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_there_is_no_create_endpoint(self) -> None:
        """§16 declares a GET and two colon-actions. A per-row create would
        bypass number generation, the render job and the issue gate."""
        response = self.client.post(ADMIT_CARDS, {"admit_card_no": "MINE-1"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)


class AdmitCardDocumentTests(AdmitCardTestCase):
    def test_a_card_lists_only_the_student_s_own_sittings(self) -> None:
        from apps.examinations import documents

        with tenant_context(self.tenant.id):
            services.issue_admit_cards(exam=self.exam, actor_id=self.user.pk)
            card = AdmitCard.objects.alive().get(exam=self.exam, student=self.students[0])
            sittings = services.student_sittings(exam=self.exam, student=self.students[0])
            html = documents.admit_card_html(
                card=card,
                exam=self.exam,
                student=self.students[0],
                sittings=sittings,
                school_name="Test School",
            )

        self.assertIn(card.admit_card_no, html)
        self.assertIn(self.subject.name, html)
        self.assertIn(self.room.code, html)
        # Instructions printed once at the foot, not repeated in every row.
        self.assertEqual(html.count("Bring a transparent pencil case"), 1)

    def test_a_name_containing_markup_is_escaped(self) -> None:
        """`core.documents.html` is escape-by-default, and this is the document
        the ID-card defect would otherwise have been repeated in."""
        from apps.examinations import documents

        with tenant_context(self.tenant.id):
            self.students[0].last_name = "<b>O'Brien</b> & Sons"
            self.students[0].save(update_fields=["last_name"])
            services.issue_admit_cards(exam=self.exam, actor_id=self.user.pk)
            card = AdmitCard.objects.alive().get(exam=self.exam, student=self.students[0])
            html = documents.admit_card_html(
                card=card,
                exam=self.exam,
                student=self.students[0],
                sittings=[],
                school_name="Test School",
            )

        self.assertNotIn("<b>O", html)
        self.assertIn("&lt;b&gt;O&#x27;Brien&lt;/b&gt; &amp; Sons", html)

    def test_a_card_with_no_sittings_says_so(self) -> None:
        """A real state — a section scheduled after the batch ran — and an
        empty grid reads as a rendering fault."""
        from apps.examinations import documents

        with tenant_context(self.tenant.id):
            services.issue_admit_cards(exam=self.exam, actor_id=self.user.pk)
            card = AdmitCard.objects.alive().filter(exam=self.exam).first()
            html = documents.admit_card_html(
                card=card,
                exam=self.exam,
                student=card.student,
                sittings=[],
                school_name="Test School",
            )

        self.assertIn("No papers scheduled", html)
