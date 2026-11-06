"""The nested question routes' record scope (PR #54's review, Major 1, and L51).

Its own file so the scope fix and its tests commit together: it imports only what
the module already had before the question-bank dashboard work.
"""

from __future__ import annotations

from rest_framework import status
from rest_framework.test import APIClient

from apps.examinations.models import QuestionSource, QuestionType
from apps.examinations.tests.factories import (
    QuestionBankFactory,
    QuestionFactory,
    SubjectFactory,
    authenticate,
    grant,
)
from apps.examinations.tests.test_question_banks import BANKS, QuestionBankTestCase
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context


class NestedQuestionScopeTests(QuestionBankTestCase):
    """PR #54's review, Major 1 — `Question` had no `filter_assigned_to_user`.

    The consequence was silent: `scope_queryset` falls through to `.none()` for
    an `assigned`-scoped principal reaching a model with no hook, so a teacher
    who could correctly see their own **bank** got an empty list of the
    questions inside it — on list, retrieve, update, delete and `:approve`
    alike. The existing scope test only exercised the bank list, which is
    exactly why it survived.

    Every nested route is asserted here, not just the list, because the gap was
    per-endpoint rather than per-model.
    """

    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.mine = self.question(topic="Algebra")
            stranger_subject = SubjectFactory(tenant=self.tenant)
            self.stranger_bank = QuestionBankFactory(tenant=self.tenant, subject=stranger_subject)
            self.not_mine = QuestionFactory(tenant=self.tenant, question_bank=self.stranger_bank)
        grant(
            self.subject_teacher_user,
            "exams.question-bank.view",
            "exams.question-bank.update",
            "exams.question.approve",
            scope=RecordScope.ASSIGNED,
        )
        self.teacher = APIClient()
        authenticate(self.teacher, self.subject_teacher_user)

    def test_an_assigned_teacher_lists_the_questions_in_their_own_bank(self) -> None:
        response = self.teacher.get(f"{BANKS}/{self.bank.pk}/questions")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual({row["id"] for row in response.json()["data"]}, {str(self.mine.pk)})

    def test_an_assigned_teacher_retrieves_a_question_in_their_own_bank(self) -> None:
        response = self.teacher.get(f"{BANKS}/{self.bank.pk}/questions/{self.mine.pk}")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())

    def test_an_assigned_teacher_edits_a_question_in_their_own_bank(self) -> None:
        response = self.teacher.patch(
            f"{BANKS}/{self.bank.pk}/questions/{self.mine.pk}",
            {"topic": "Geometry"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())

    def test_an_assigned_teacher_approves_an_ai_question_in_their_own_bank(self) -> None:
        """The endpoint the gap mattered most on: §7.2's approval is what stands
        between an AI draft and a student, and a teacher silently unable to
        reach it would leave drafts unapproved with no error to report."""
        with tenant_context(self.tenant.id):
            draft = self.question(source=QuestionSource.AI_GENERATED, is_approved=False)

        response = self.teacher.post(f"{BANKS}/{self.bank.pk}/questions/{draft.pk}:approve")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())

    def test_an_assigned_teacher_deletes_a_question_in_their_own_bank(self) -> None:
        grant(
            self.subject_teacher_user,
            "exams.question-bank.view",
            "exams.question-bank.delete",
            scope=RecordScope.ASSIGNED,
        )

        response = self.teacher.delete(f"{BANKS}/{self.bank.pk}/questions/{self.mine.pk}")

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

    def test_a_question_in_a_bank_they_do_not_teach_is_out_of_reach(self) -> None:
        """The control. Adding the hook must narrow, not merely unblock — the
        fix would be worthless if it granted everything."""
        response = self.teacher.get(f"{BANKS}/{self.stranger_bank.pk}/questions/{self.not_mine.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_an_unassigned_teacher_cannot_read_another_subjects_bank_questions(self) -> None:
        """L51: the bank in the URL resolves through its own record scope, so a bank
        outside the teacher's subjects is a 404, not an empty 200 that confirms it."""
        response = self.teacher.get(f"{BANKS}/{self.stranger_bank.pk}/questions")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_an_assigned_teacher_adds_a_question_to_their_own_bank(self) -> None:
        """The control for the create below: the scoped lookup must still let this through."""
        grant(self.subject_teacher_user, "exams.question-bank.create", scope=RecordScope.ASSIGNED)

        response = self.teacher.post(
            f"{BANKS}/{self.bank.pk}/questions",
            {"question_text": "2 + 2?", "question_type": QuestionType.SHORT_ANSWER},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        self.assertEqual(response.json()["data"]["question_bank_id"], str(self.bank.pk))

    def test_an_unassigned_teacher_cannot_add_a_question_to_another_subjects_bank(self) -> None:
        """The write the unscoped lookup let through: a create saved into the bank by id."""
        grant(self.subject_teacher_user, "exams.question-bank.create", scope=RecordScope.ASSIGNED)

        response = self.teacher.post(
            f"{BANKS}/{self.stranger_bank.pk}/questions",
            {"question_text": "2 + 2?", "question_type": QuestionType.SHORT_ANSWER},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        with tenant_context(self.tenant.id):
            self.assertEqual(self.stranger_bank.questions.count(), 1)

    def test_the_hook_delegates_rather_than_restating_the_allocation_join(self) -> None:
        """A second copy of the predicate is a second place for a reassigned
        teacher to keep access."""
        from apps.examinations.models import Question as QuestionModel

        with tenant_context(self.tenant.id):
            scoped = QuestionModel.filter_assigned_to_user(
                QuestionModel.objects.alive(), self.subject_teacher_user
            )

            self.assertEqual(
                {row.pk for row in scoped}, {row.pk for row in self.bank.questions.all()}
            )


class MixedRoleBankLookupTests(QuestionBankTestCase):
    """ADR-0031 decision 3 on the nested routes' bank lookup (`scoped_question_bank`).

    `QuestionBank` has no campus column, so the narrowing role is `assigned`: the
    teacher teaches `self.subject` only. A wide role holding a different key must not
    lift the bank lookup past the narrow one, in either direction.
    """

    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.stranger_bank = QuestionBankFactory(
                tenant=self.tenant, subject=SubjectFactory(tenant=self.tenant)
            )
            self.draft = QuestionFactory(
                tenant=self.tenant,
                question_bank=self.stranger_bank,
                source=QuestionSource.AI_GENERATED,
                is_approved=False,
            )
        self.teacher = APIClient()
        authenticate(self.teacher, self.subject_teacher_user)

    def test_an_all_action_role_cannot_reach_a_bank_the_view_role_hides(self) -> None:
        grant(self.subject_teacher_user, "exams.question-bank.view", scope=RecordScope.ASSIGNED)
        grant(self.subject_teacher_user, "exams.question.approve", scope=RecordScope.ALL)

        response = self.teacher.post(
            f"{BANKS}/{self.stranger_bank.pk}/questions/{self.draft.pk}:approve"
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        with tenant_context(self.tenant.id):
            self.draft.refresh_from_db()
        self.assertFalse(self.draft.is_approved)

    def test_an_all_view_role_cannot_lift_the_create_key_past_its_assigned_role(self) -> None:
        """The route's own key narrows the bank too: a create saved into a bank by id."""
        grant(self.subject_teacher_user, "exams.question-bank.view", scope=RecordScope.ALL)
        grant(self.subject_teacher_user, "exams.question-bank.create", scope=RecordScope.ASSIGNED)

        response = self.teacher.post(
            f"{BANKS}/{self.stranger_bank.pk}/questions",
            {"question_text": "2 + 2?", "question_type": QuestionType.SHORT_ANSWER},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        with tenant_context(self.tenant.id):
            self.assertEqual(self.stranger_bank.questions.count(), 1)

    def test_the_same_create_reaches_a_bank_both_roles_cover(self) -> None:
        """The control: the teacher's own subject's bank passes both keys."""
        grant(self.subject_teacher_user, "exams.question-bank.view", scope=RecordScope.ALL)
        grant(self.subject_teacher_user, "exams.question-bank.create", scope=RecordScope.ASSIGNED)

        response = self.teacher.post(
            f"{BANKS}/{self.bank.pk}/questions",
            {"question_text": "2 + 2?", "question_type": QuestionType.SHORT_ANSWER},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
