"""§5.3's admit cards — constraints, the idempotent batch, and revocation.

The batch is where the interesting behaviour is. §8's exam-staff journey is
"issues admit cards in one batch", which in practice means pressing the button
again after the roll changes — so a re-run is the normal case rather than an
error, and the two things it must *not* do are duplicate a card or quietly
reinstate one somebody revoked.
"""

from __future__ import annotations

from django.db import IntegrityError, connection, transaction
from django.test.utils import CaptureQueriesContext
from rest_framework import status

from apps.examinations import services, tasks, uploads
from apps.examinations.models import AdmitCard, AdmitCardStatus, ExamStatus
from apps.examinations.tests.base import ExaminationsAPITestCase
from apps.examinations.tests.factories import (
    AcademicSessionFactory,
    AdmitCardFactory,
    ExamFactory,
    ExamScheduleFactory,
    ExamSubjectFactory,
    RoomFactory,
    SectionFactory,
    StaffFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    exam_week,
)
from core.files.models import File
from core.jobs.tests.base import assert_sent_on_commit
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

    def test_the_render_is_sent_only_after_its_job_commits(self) -> None:
        assert_sent_on_commit(
            self,
            tasks.render_admit_cards_task,
            lambda: self.client.post(f"/api/v1/exams/{self.exam.pk}:issue-admit-cards"),
            tenant_id=self.tenant.pk,
            actor_id=self.user.pk,
        )

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

    def test_issue_answers_the_added_and_existing_counts(self) -> None:
        with tenant_context(self.tenant.id):
            AdmitCardFactory(tenant=self.tenant, exam=self.exam, student=self.students[0])

        response = self.client.post(f"/api/v1/exams/{self.exam.pk}:issue-admit-cards")

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        data = response.json()["data"]
        self.assertEqual(set(data), {"job_id", "status", "added", "existing"})
        self.assertEqual((data["added"], data["existing"]), (2, 1))

    def test_an_exam_outside_the_caller_s_scope_is_a_404(self) -> None:
        """Resolved through `ExamViewSet`'s record scope, not a bare lookup."""
        from rest_framework.test import APIClient

        from apps.examinations.tests.factories import UserFactory, authenticate, grant
        from core.rbac.models import RecordScope

        with tenant_context(self.tenant.id):
            outsider = UserFactory(tenant=self.tenant)
            StaffFactory(tenant=self.tenant, campus=self.campus, user_id=outsider.pk)
        grant(outsider, "exams.admit-card.issue", scope=RecordScope.ASSIGNED)
        client = APIClient()
        authenticate(client, outsider)

        response = client.post(f"/api/v1/exams/{self.exam.pk}:issue-admit-cards")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        with tenant_context(self.tenant.id):
            self.assertFalse(AdmitCard.objects.alive().filter(exam=self.exam).exists())

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


class RenderJobRevokeRaceTests(AdmitCardTestCase):
    """A revoke made while the render job runs must survive the job's save."""

    def setUp(self) -> None:
        super().setUp()
        from core.jobs.services import create_job

        with tenant_context(self.tenant.id):
            services.issue_admit_cards(exam=self.exam, actor_id=self.user.pk)
            self.card = AdmitCard.objects.alive().get(exam=self.exam, student=self.students[0])
            self.job = create_job(
                tenant_id=self.tenant.pk,
                job_type="exams.admit-cards",
                payload={"exam_id": str(self.exam.pk), "requested_by": str(self.user.pk)},
                actor_id=self.user.pk,
            )

    def test_a_card_revoked_between_the_read_and_the_save_stays_revoked(self) -> None:
        from unittest import mock

        card_pk = self.card.pk
        actor_id = self.user.pk

        def revoke_then_render(html):
            # The job has already read every card; this is the revoke a clerk
            # makes while the first PDF is still rendering.
            if "revoked" not in calls:
                calls.append("revoked")
                card = AdmitCard.objects.alive().get(pk=card_pk)
                services.revoke_admit_card(card=card, reason="Fees", actor_id=actor_id)
            return b"%PDF-stub"

        calls: list[str] = []
        with (
            mock.patch("core.documents.render_pdf", side_effect=revoke_then_render),
            mock.patch.object(tasks.notify_admit_cards_issued, "delay"),
        ):
            tasks.render_admit_cards_task(
                tenant_id=str(self.tenant.pk),
                job_id=str(self.job.pk),
                actor_id=str(self.user.pk),
            )

        with tenant_context(self.tenant.id):
            self.card.refresh_from_db()
            others = AdmitCard.objects.alive().filter(exam=self.exam).exclude(pk=card_pk)
            self.assertTrue(all(other.status == AdmitCardStatus.ISSUED for other in others))
            # The PDF rendered for the revoked card is retired, not left live and unreferenced.
            retired = File.objects.filter(mime_type="application/pdf", deleted_at__isnull=False)
            self.assertEqual(retired.count(), 1)
            self.assertFalse(AdmitCard.objects.filter(file__in=retired).exists())
        self.assertEqual(calls, ["revoked"])
        self.assertEqual(self.card.status, AdmitCardStatus.REVOKED)
        self.assertEqual(self.card.revoked_reason, "Fees")
        self.assertIsNone(self.card.file_id)


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


class AdmitCardAssignedScopeTests(AdmitCardTestCase):
    """§4's `assigned` on cards: a class teacher's homeroom, in its own session."""

    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            services.issue_admit_cards(exam=self.exam, actor_id=self.user.pk)
            self.last_year = AcademicSessionFactory(tenant=self.tenant)

    def listed_as(self, user) -> set[str]:
        from apps.examinations.tests.factories import authenticate, grant
        from core.rbac.models import RecordScope

        grant(user, "exams.admit-card.view", scope=RecordScope.ASSIGNED)
        authenticate(self.client, user)
        response = self.client.get(ADMIT_CARDS)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return {row["id"] for row in response.json()["data"]}

    def current_cards(self) -> set[str]:
        with tenant_context(self.tenant.id):
            return {
                str(pk)
                for pk in AdmitCard.objects.alive()
                .filter(exam=self.exam)
                .values_list("pk", flat=True)
            }

    def test_a_class_teacher_sees_their_homeroom_s_cards(self) -> None:
        self.assertEqual(self.listed_as(self.teacher_user), self.current_cards())

    def test_last_session_s_homeroom_shows_no_current_session_card(self) -> None:
        """A teacher whose homeroom was last year's sees none of this year's
        cards, even for a student who was in that homeroom."""
        from apps.examinations.tests.factories import UserFactory

        with tenant_context(self.tenant.id):
            former_user = UserFactory(tenant=self.tenant)
            former = StaffFactory(tenant=self.tenant, campus=self.campus, user_id=former_user.pk)
            old_homeroom = SectionFactory(
                tenant=self.tenant,
                school_class=self.school_class,
                campus=self.campus,
                class_teacher_staff_id=former.pk,
            )
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=self.students[0],
                academic_session=self.last_year,
                school_class=self.school_class,
                section=old_homeroom,
            )

        self.assertEqual(self.listed_as(former_user), set())

    def test_this_session_s_homeroom_shows_no_last_session_card(self) -> None:
        """The same section last year, a closed session's card: not this
        year's class teacher's."""
        from apps.student_management.models import EnrollmentStatus

        with tenant_context(self.tenant.id):
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=self.students[0],
                academic_session=self.last_year,
                school_class=self.school_class,
                section=self.section,
                status=EnrollmentStatus.PROMOTED,
            )
            old_exam = ExamFactory(
                tenant=self.tenant,
                academic_session=self.last_year,
                grading_scale=self.scale,
                status=ExamStatus.SCHEDULED,
            )
            AdmitCardFactory(tenant=self.tenant, exam=old_exam, student=self.students[0])

        self.assertEqual(self.listed_as(self.teacher_user), self.current_cards())


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


class AdmitCardNamesTests(AdmitCardTestCase):
    """The names and section a card row renders, from the student's
    enrollment in the exam's own session, in any status."""

    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            # A second roster, scheduled too, so its students get cards.
            self.other_students = [
                StudentFactory(tenant=self.tenant, campus=self.campus) for _ in range(2)
            ]
            for student in self.other_students:
                StudentEnrollmentFactory(
                    tenant=self.tenant,
                    student=student,
                    academic_session=self.session,
                    school_class=self.school_class,
                    section=self.other_section,
                )
            ExamScheduleFactory(
                tenant=self.tenant,
                exam_subject=self.exam_subject,
                section=self.other_section,
                exam_date=self.day,
            )
            services.issue_admit_cards(exam=self.exam, actor_id=self.user.pk)

    def listed(self, query: str = "") -> dict[str, dict]:
        response = self.client.get(f"{ADMIT_CARDS}{query}")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return {row["student_id"]: row for row in response.json()["data"]}

    def test_a_card_carries_the_student_s_name_admission_number_and_section(self) -> None:
        student = self.students[0]

        row = self.listed()[str(student.pk)]

        self.assertEqual(row["student_name"], student.full_name)
        self.assertEqual(row["admission_number"], student.admission_number)
        self.assertEqual(row["section_id"], str(self.section.pk))
        self.assertEqual(row["section_name"], self.section.name)

    def test_the_section_is_the_exam_session_s_not_another_session_s(self) -> None:
        """A student enrolled last year in another section sits *this* exam in
        this year's section; the card must say so."""
        with tenant_context(self.tenant.id):
            last_year = AcademicSessionFactory(tenant=self.tenant)
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=self.students[0],
                academic_session=last_year,
                school_class=self.school_class,
                section=self.other_section,
            )

        row = self.listed()[str(self.students[0].pk)]

        self.assertEqual(row["section_id"], str(self.section.pk))

    def test_a_card_serialized_outside_the_list_falls_back_to_its_own_read(self) -> None:
        """A single card that never passed through the viewset's `Prefetch`
        resolves the same section with a query of its own (lesson L24)."""
        from apps.examinations.serializers import AdmitCardSerializer

        with tenant_context(self.tenant.id):
            card = AdmitCard.objects.alive().get(exam=self.exam, student=self.students[0])
            data = AdmitCardSerializer(card).data

        self.assertEqual(data["section_id"], self.section.pk)
        self.assertEqual(data["section_name"], self.section.name)
        self.assertEqual(data["student_name"], self.students[0].full_name)

    def test_revoking_answers_with_the_card_s_names(self) -> None:
        with tenant_context(self.tenant.id):
            card = AdmitCard.objects.alive().get(exam=self.exam, student=self.students[0])

        response = self.client.post(
            f"{ADMIT_CARDS}/{card.pk}:revoke", {"reason": "Fees"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["section_name"], self.section.name)
        self.assertEqual(
            response.json()["data"]["admission_number"], self.students[0].admission_number
        )

    def test_cards_filter_by_section_through_the_exam_session_s_enrollment(self) -> None:
        # A homeroom student with last year's enrollment in the other section
        # must not match it: only the exam session's enrollment counts.
        with tenant_context(self.tenant.id):
            last_year = AcademicSessionFactory(tenant=self.tenant)
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=self.students[0],
                academic_session=last_year,
                school_class=self.school_class,
                section=self.other_section,
            )

        listed = self.listed(f"?section_id={self.other_section.pk}")

        self.assertEqual(set(listed), {str(student.pk) for student in self.other_students})

    def test_a_promoted_student_s_card_keeps_the_closed_session_s_section(self) -> None:
        """Promotion turns the exam session's enrollment `promoted`; the card
        still names, and filters by, the section the student sat in."""
        from apps.student_management.models import EnrollmentStatus, StudentEnrollment

        student = self.other_students[0]
        with tenant_context(self.tenant.id):
            StudentEnrollment.objects.alive().filter(
                student=student, academic_session=self.session
            ).update(status=EnrollmentStatus.PROMOTED, end_date=self.session.end_date)
            next_year = AcademicSessionFactory(tenant=self.tenant)
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=student,
                academic_session=next_year,
                school_class=self.school_class,
                section=self.section,
            )

        row = self.listed()[str(student.pk)]
        filtered = self.listed(f"?section_id={self.other_section.pk}")

        self.assertEqual(row["section_id"], str(self.other_section.pk))
        self.assertEqual(row["section_name"], self.other_section.name)
        self.assertIn(str(student.pk), filtered)
        self.assertNotIn(str(student.pk), self.listed(f"?section_id={self.section.pk}"))

    def test_the_list_costs_the_same_for_two_cards_or_five(self) -> None:
        """One `Prefetch` resolves every row's section; more rows must not
        add queries."""
        query = f"?section_id={self.other_section.pk}"
        # Warm the per-user permission caches, so the baseline counts the
        # list's own queries and not a cold first request.
        self.client.get(f"{ADMIT_CARDS}{query}")
        with CaptureQueriesContext(connection) as baseline:
            self.assertEqual(len(self.listed(query)), 2)

        with self.assertNumQueries(len(baseline)):
            response = self.client.get(ADMIT_CARDS)

        self.assertEqual(len(response.json()["data"]), 5)


class AdmitCardDownloadTests(AdmitCardTestCase):
    """`POST /admit-cards/{id}:download` — ADR-0021's resource-scoped link."""

    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            services.issue_admit_cards(exam=self.exam, actor_id=self.user.pk)
            self.mine = AdmitCard.objects.alive().get(exam=self.exam, student=self.students[0])
            self.theirs = AdmitCard.objects.alive().get(exam=self.exam, student=self.students[1])
        self.attach_file(self.mine)
        self.attach_file(self.theirs)

    def attach_file(self, card: AdmitCard) -> None:
        """What the render job leaves behind: a ready PDF on the card."""
        from core.files.services import create_ready_file

        with tenant_context(self.tenant.id):
            card.file = create_ready_file(
                tenant_id=self.tenant.pk,
                purpose=uploads.ADMIT_CARD.key,
                original_name="admit-card.pdf",
                mime_type="application/pdf",
                data=b"%PDF-stub",
                actor_id=self.user.pk,
            )
            card.save(update_fields=["file"])

    def download(self, card: AdmitCard, client=None):
        return (client or self.client).post(f"{ADMIT_CARDS}/{card.pk}:download")

    def student_client(self):
        """`self.students[0]`'s own portal login, `own`-scoped."""
        from rest_framework.test import APIClient

        from apps.examinations.tests.factories import UserFactory, authenticate, grant
        from core.rbac.models import RecordScope

        with tenant_context(self.tenant.id):
            student_user = UserFactory(tenant=self.tenant)
            self.students[0].user_id = student_user.pk
            self.students[0].save(update_fields=["user_id"])
        grant(
            student_user,
            "exams.admit-card.view",
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

    def test_a_student_downloads_their_own_card(self) -> None:
        response = self.download(self.mine, self.student_client())

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertTrue(response.json()["data"]["download_url"])

    def test_a_student_asking_for_another_s_card_gets_a_404(self) -> None:
        """The record scope on `get_object()`, not the key, decides: a 404, so
        the other card's existence is not confirmed."""
        response = self.download(self.theirs, self.student_client())

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_revoked_card_is_a_404_even_with_its_file(self) -> None:
        with tenant_context(self.tenant.id):
            services.revoke_admit_card(card=self.mine, reason="Fees", actor_id=self.user.pk)

        response = self.download(self.mine)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_card_not_yet_rendered_is_a_404(self) -> None:
        with tenant_context(self.tenant.id):
            self.mine.file = None
            self.mine.save(update_fields=["file"])

        response = self.download(self.mine)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_card_whose_file_was_retired_is_a_404(self) -> None:
        """Mirrors `core/files`' `get_display_url`: a soft-deleted file is no
        document, even though the card still points at it."""
        from django.utils import timezone

        with tenant_context(self.tenant.id):
            self.mine.file.deleted_at = timezone.now()
            self.mine.file.save(update_fields=["deleted_at", "updated_at"])

        response = self.download(self.mine)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def guardian_client(self):
        """A guardian linked to `self.students[0]` only, `own`-scoped."""
        from rest_framework.test import APIClient

        from apps.examinations.tests.factories import (
            GuardianFactory,
            StudentGuardianFactory,
            UserFactory,
            authenticate,
            grant,
        )
        from core.rbac.models import RecordScope

        guardian_user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            guardian = GuardianFactory(tenant=self.tenant, user_id=guardian_user.pk)
            StudentGuardianFactory(
                tenant=self.tenant,
                student=self.students[0],
                guardian=guardian,
                has_portal_access=True,
            )
        grant(
            guardian_user,
            "exams.admit-card.view",
            scope=RecordScope.OWN,
            is_restricted_principal=True,
        )
        client = APIClient()
        authenticate(client, guardian_user)
        return client

    def test_a_guardian_downloads_their_child_s_card(self) -> None:
        response = self.download(self.mine, self.guardian_client())

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertTrue(response.json()["data"]["download_url"])

    def test_a_guardian_asking_for_another_child_s_card_gets_a_404(self) -> None:
        response = self.download(self.theirs, self.guardian_client())

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_download_costs_a_fixed_number_of_queries(self) -> None:
        """One card with its file joined; no enrollment `Prefetch`, which the
        list needs and a download does not."""
        self.download(self.mine)  # Warm the per-user permission caches.
        with CaptureQueriesContext(connection) as baseline:
            self.assertEqual(self.download(self.mine).status_code, status.HTTP_200_OK)

        self.assertFalse(
            any("student_enrollments" in query["sql"] for query in baseline.captured_queries)
        )
        with self.assertNumQueries(len(baseline)):
            self.download(self.theirs)

    def test_downloading_needs_the_admit_card_view_key(self) -> None:
        """Its own gate, not `core/files`' broad `platform.file.view` (ADR-0021)."""
        from rest_framework.test import APIClient

        from apps.examinations.tests.factories import UserFactory, authenticate, grant
        from core.rbac.models import RecordScope

        other = UserFactory(tenant=self.tenant)
        grant(other, "platform.file.view", "exams.exam.view", scope=RecordScope.ALL)
        client = APIClient()
        authenticate(client, other)

        self.assertEqual(self.download(self.mine, client).status_code, 403)
