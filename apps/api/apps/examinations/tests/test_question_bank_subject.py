"""§4 — an `assigned` creator keeps a question bank only in a subject they teach.

The write side of `QuestionBank.filter_assigned_to_user`: without it a teacher
could create a bank (or move theirs) into a subject they would then be unable
to see. `all` and `campus` callers are unrestricted, as their reads are.
"""

from __future__ import annotations

from rest_framework import status
from rest_framework.test import APIClient

from apps.examinations.models import QuestionBank
from apps.examinations.tests.factories import SubjectFactory, authenticate, grant
from apps.examinations.tests.test_question_banks import BANKS, QuestionBankTestCase
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

REFUSAL = "You can keep a question bank only in a subject you currently teach."


class BankSubjectTests(QuestionBankTestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.stranger_subject = SubjectFactory(tenant=self.tenant)
        grant(
            self.subject_teacher_user,
            "exams.question-bank.view",
            "exams.question-bank.create",
            "exams.question-bank.update",
            scope=RecordScope.ASSIGNED,
        )
        self.teacher = APIClient()
        authenticate(self.teacher, self.subject_teacher_user)

    def assert_refused_on_subject(self, response) -> None:
        self.assertEqual(
            response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY, response.json()
        )
        self.assertEqual(
            response.json()["error"]["details"], [{"field": "subject_id", "issue": REFUSAL}]
        )

    def test_creating_a_bank_in_a_subject_they_do_not_teach_is_refused(self) -> None:
        response = self.teacher.post(
            BANKS, {"name": "Stray", "subject_id": str(self.stranger_subject.pk)}, format="json"
        )

        self.assert_refused_on_subject(response)
        with tenant_context(self.tenant.id):
            self.assertFalse(QuestionBank.objects.filter(name="Stray").exists())

    def test_moving_their_bank_into_another_subject_is_refused(self) -> None:
        response = self.teacher.patch(
            f"{BANKS}/{self.bank.pk}",
            {"subject_id": str(self.stranger_subject.pk)},
            format="json",
        )

        self.assert_refused_on_subject(response)
        with tenant_context(self.tenant.id):
            self.bank.refresh_from_db()
        self.assertEqual(self.bank.subject_id, self.subject.pk)

    def test_a_bank_in_a_subject_they_teach_is_allowed(self) -> None:
        created = self.teacher.post(
            BANKS, {"name": "Mine", "subject_id": str(self.subject.pk)}, format="json"
        )
        renamed = self.teacher.patch(f"{BANKS}/{self.bank.pk}", {"name": "Renamed"}, format="json")

        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.json())
        self.assertEqual(created.json()["data"]["subject_id"], str(self.subject.pk))
        self.assertEqual(renamed.status_code, status.HTTP_200_OK, renamed.json())

    def test_an_all_scope_caller_is_unrestricted(self) -> None:
        """The control: the rule narrows `assigned` alone."""
        response = self.client.post(
            BANKS, {"name": "Any", "subject_id": str(self.stranger_subject.pk)}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
