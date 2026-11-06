"""The question-bank wire contract: names on the row, page numbers, flat query
counts, `:assemble-paper`'s job result as §16 documents it, and the agreement
between the bank scope and the nested question routes (L56)."""

from __future__ import annotations

import datetime

from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework import status
from rest_framework.test import APIClient

from apps.academics.tests.factories import TeacherAllocationFactory
from apps.examinations.models import QuestionBank, QuestionDifficulty, QuestionSource
from apps.examinations.tests.factories import (
    ClassFactory,
    QuestionBankFactory,
    SubjectFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.examinations.tests.test_paper_assembly_marks import assemble_inline
from apps.examinations.tests.test_question_banks import BANKS, QuestionBankTestCase
from core.jobs.models import JobStatus
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

PAGE_META_KEYS = {"page", "page_size", "total_count", "total_pages"}


class BankRowTests(QuestionBankTestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.classed = QuestionBankFactory(
                tenant=self.tenant, subject=self.subject, school_class=self.school_class
            )

    def row(self, response, bank) -> dict:
        return next(row for row in response.json()["data"] if row["id"] == str(bank.pk))

    def test_a_listed_bank_carries_its_subject_and_class_names(self) -> None:
        response = self.client.get(BANKS)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        row = self.row(response, self.classed)
        self.assertEqual(row["subject_name"], self.subject.name)
        self.assertEqual(row["class_name"], self.school_class.name)

    def test_a_bank_for_every_level_has_no_class_name(self) -> None:
        row = self.row(self.client.get(BANKS), self.bank)

        self.assertIsNone(row["class_id"])
        self.assertIsNone(row["class_name"])

    def test_a_single_bank_carries_the_names_too(self) -> None:
        response = self.client.get(f"{BANKS}/{self.classed.pk}")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        data = response.json()["data"]
        self.assertEqual(data["subject_name"], self.subject.name)
        self.assertEqual(data["class_name"], self.school_class.name)

    def test_a_created_bank_answers_with_its_names(self) -> None:
        response = self.client.post(
            BANKS,
            {
                "subject_id": str(self.subject.pk),
                "class_id": str(self.school_class.pk),
                "name": "Revision",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        data = response.json()["data"]
        self.assertEqual(data["subject_name"], self.subject.name)
        self.assertEqual(data["class_name"], self.school_class.name)

    def test_banks_are_paged_by_number(self) -> None:
        with tenant_context(self.tenant.id):
            QuestionBankFactory(tenant=self.tenant, subject=self.subject)

        response = self.client.get(BANKS, {"page_size": 2, "page": 2})

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(
            response.json()["meta"]["pagination"],
            {"page": 2, "page_size": 2, "total_count": 3, "total_pages": 2},
        )
        self.assertEqual(len(response.json()["data"]), 1)

    def test_same_name_banks_page_apart_without_repeating(self) -> None:
        """Names repeat across subjects; the `pk` tiebreaker keeps the order total."""
        with tenant_context(self.tenant.id):
            for _ in range(3):
                QuestionBankFactory(
                    tenant=self.tenant, subject=SubjectFactory(tenant=self.tenant), name="Revision"
                )

        seen = []
        for page in (1, 2, 3, 4, 5):
            response = self.client.get(BANKS, {"page_size": 1, "page": page})
            self.assertEqual(set(response.json()["meta"]["pagination"]), PAGE_META_KEYS)
            seen.extend(row["id"] for row in response.json()["data"])

        self.assertEqual(len(seen), 5)
        self.assertEqual(len(set(seen)), 5)

    def test_the_list_is_a_flat_number_of_queries(self) -> None:
        """Subject and class are joins in the list's own query, whatever the page holds."""
        self.client.get(BANKS)  # warm the permission and scope caches
        with CaptureQueriesContext(connection) as few:
            self.client.get(BANKS)
        with tenant_context(self.tenant.id):
            for _ in range(3):
                QuestionBankFactory(
                    tenant=self.tenant,
                    subject=SubjectFactory(tenant=self.tenant),
                    school_class=self.school_class,
                )

        with CaptureQueriesContext(connection) as many:
            response = self.client.get(BANKS)

        self.assertEqual(len(response.json()["data"]), 5)
        self.assertEqual(len(many.captured_queries), len(few.captured_queries))


class QuestionRowTests(QuestionBankTestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.approver = UserFactory(tenant=self.tenant, first_name="Ann", last_name="Lee")
            self.approved = self.question(
                source=QuestionSource.AI_GENERATED, is_approved=True, approved_by=self.approver.pk
            )
            self.manual = self.question()

    def questions_url(self) -> str:
        return f"{BANKS}/{self.bank.pk}/questions"

    def by_id(self, response) -> dict:
        return {row["id"]: row for row in response.json()["data"]}

    def test_a_listed_question_carries_its_approver_name(self) -> None:
        response = self.client.get(self.questions_url())

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        rows = self.by_id(response)
        self.assertEqual(rows[str(self.approved.pk)]["approved_by"], str(self.approver.pk))
        self.assertEqual(rows[str(self.approved.pk)]["approved_by_name"], "Ann Lee")
        # A teacher's own question is approved with no approver to name.
        self.assertIsNone(rows[str(self.manual.pk)]["approved_by"])
        self.assertIsNone(rows[str(self.manual.pk)]["approved_by_name"])

    def test_a_single_question_carries_the_name_too(self) -> None:
        """L24: the name comes from the mixin, so a single-object read needs its own test."""
        response = self.client.get(f"{self.questions_url()}/{self.approved.pk}")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["approved_by_name"], "Ann Lee")

    def test_approve_answers_the_question_with_its_approver_name(self) -> None:
        """L24 again: `:approve` serializes one question outside the list."""
        with tenant_context(self.tenant.id):
            draft = self.question(source=QuestionSource.AI_GENERATED, is_approved=False)

        response = self.client.post(f"{self.questions_url()}/{draft.pk}:approve")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        data = response.json()["data"]
        self.assertEqual(data["approved_by"], str(self.user.pk))
        self.assertEqual(data["approved_by_name"], f"{self.user.first_name} {self.user.last_name}")

    def test_a_created_ai_draft_answers_with_no_approver(self) -> None:
        response = self.client.post(
            self.questions_url(),
            {
                "question_text": "Name a prime.",
                "question_type": "short_answer",
                "source": QuestionSource.AI_GENERATED,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        data = response.json()["data"]
        self.assertFalse(data["is_approved"])
        self.assertIsNone(data["approved_by"])
        self.assertIsNone(data["approved_by_name"])

    def test_approved_by_is_not_settable_through_the_api(self) -> None:
        response = self.client.patch(
            f"{self.questions_url()}/{self.manual.pk}",
            {"approved_by": str(self.approver.pk)},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertIsNone(response.json()["data"]["approved_by"])

    def test_the_list_is_a_flat_number_of_queries(self) -> None:
        """One user-name query per page, however many approvers the page names."""
        self.client.get(self.questions_url())  # warm the permission and scope caches
        with CaptureQueriesContext(connection) as few:
            self.client.get(self.questions_url())
        with tenant_context(self.tenant.id):
            for index in range(3):
                approver = UserFactory(tenant=self.tenant, first_name=f"A{index}")
                self.question(
                    source=QuestionSource.AI_GENERATED, is_approved=True, approved_by=approver.pk
                )

        with CaptureQueriesContext(connection) as many:
            response = self.client.get(self.questions_url())

        self.assertEqual(len(response.json()["data"]), 5)
        self.assertEqual(len(many.captured_queries), len(few.captured_queries))


class AssemblyResultTests(QuestionBankTestCase):
    def test_the_job_result_is_the_shape_section_16_documents(self) -> None:
        """`{result_file_id, questions, total_marks}`, the keys the dashboard reads."""
        self.stock(easy=3)

        job = assemble_inline(self, {"difficulty": QuestionDifficulty.EASY, "count": 2})

        self.assertEqual(job.status, JobStatus.SUCCEEDED, job.error)
        self.assertEqual(set(job.result), {"result_file_id", "questions", "total_marks"})
        self.assertEqual(job.result["questions"], 2)
        # Two questions at the factory's 2.00 marks each, as a decimal string.
        self.assertEqual(job.result["total_marks"], "4.00")


class BankScopeAgreementTests(QuestionBankTestCase):
    """L56: the bank list, the hook and the nested routes' bank lookup are one predicate."""

    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            other_class = ClassFactory(tenant=self.tenant, level=9)
            # A bank matches on its subject alone, so another class still counts.
            self.other_class_bank = QuestionBankFactory(
                tenant=self.tenant, subject=self.subject, school_class=other_class
            )
            self.stranger_bank = QuestionBankFactory(
                tenant=self.tenant, subject=SubjectFactory(tenant=self.tenant)
            )
            ended_subject = SubjectFactory(tenant=self.tenant)
            # An end-dated allocation is not current, so its subject's bank is out of scope.
            TeacherAllocationFactory(
                tenant=self.tenant,
                academic_session=self.session,
                section=self.other_section,
                subject=ended_subject,
                staff=self.subject_teacher,
                effective_to=datetime.date(2026, 1, 1),
            )
            self.ended_bank = QuestionBankFactory(tenant=self.tenant, subject=ended_subject)
        self.banks = (self.bank, self.other_class_bank, self.stranger_bank, self.ended_bank)
        grant(
            self.subject_teacher_user,
            "exams.question-bank.view",
            "exams.question-bank.create",
            scope=RecordScope.ASSIGNED,
        )
        self.teacher = APIClient()
        authenticate(self.teacher, self.subject_teacher_user)

    def test_the_hook_the_bank_list_and_the_nested_routes_agree(self) -> None:
        with tenant_context(self.tenant.id):
            scoped = {
                bank.pk
                for bank in QuestionBank.filter_assigned_to_user(
                    QuestionBank.objects.alive(), self.subject_teacher_user
                )
            }
        self.assertEqual(scoped, {self.bank.pk, self.other_class_bank.pk})

        listed = {row["id"] for row in self.teacher.get(BANKS).json()["data"]}
        self.assertEqual(listed, {str(pk) for pk in scoped})
        for bank in self.banks:
            questions = self.teacher.get(f"{BANKS}/{bank.pk}/questions")
            created = self.teacher.post(
                f"{BANKS}/{bank.pk}/questions",
                {"question_text": "2 + 2?", "question_type": "short_answer"},
                format="json",
            )
            expected = bank.pk in scoped
            self.assertEqual(questions.status_code == status.HTTP_200_OK, expected, bank.name)
            self.assertEqual(created.status_code == status.HTTP_201_CREATED, expected, bank.name)

    def test_a_homeroom_alone_grants_no_bank(self) -> None:
        """The class teacher teaches no subject here, so they reach no bank."""
        grant(self.teacher_user, "exams.question-bank.view", scope=RecordScope.ASSIGNED)
        client = APIClient()
        authenticate(client, self.teacher_user)

        response = client.get(BANKS)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"], [])
        questions = client.get(f"{BANKS}/{self.bank.pk}/questions")
        self.assertEqual(questions.status_code, status.HTTP_404_NOT_FOUND)
