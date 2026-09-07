"""§5.8's question banks, §7.2's approval gate, and deterministic assembly.

Two properties carry most of the weight here:

- **§7.2's gate is asymmetric, and the asymmetry is the design.** A question a
  teacher wrote is usable as soon as it is saved — they have already exercised
  the judgement, and asking them to approve their own is friction with no
  safeguard behind it. An AI draft arrives unapproved and needs a named human,
  which is AGENTS.md invariant 5 in a column.
- **Assembly is deterministic.** Ordered by `usage_count` then creation, so two
  runs of the same blueprint over an unchanged bank produce the same paper — a
  teacher who regenerates after fixing a typo in the title should not get a
  different exam — and reuse spreads across the bank, which is what makes §6's
  usage tracking worth keeping.
"""

from __future__ import annotations

from decimal import Decimal

from django.db import IntegrityError, transaction
from rest_framework import status
from rest_framework.test import APIClient

from apps.examinations import documents, services
from apps.examinations.models import (
    Question,
    QuestionDifficulty,
    QuestionSource,
    QuestionType,
)
from apps.examinations.tests.base import ExaminationsAPITestCase
from apps.examinations.tests.factories import (
    QuestionBankFactory,
    QuestionFactory,
    SubjectFactory,
    UserFactory,
    authenticate,
    grant,
)
from core.api.exceptions import Conflict, DomainRuleViolation
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

BANKS = "/api/v1/question-banks"


class QuestionBankTestCase(ExaminationsAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow_everything()
        with tenant_context(self.tenant.id):
            self.bank = QuestionBankFactory(tenant=self.tenant, subject=self.subject)

    def question(self, **kwargs):
        defaults = {"tenant": self.tenant, "question_bank": self.bank}
        defaults.update(kwargs)
        return QuestionFactory(**defaults)

    def stock(self, easy: int = 0, medium: int = 0, hard: int = 0, topic=None):
        with tenant_context(self.tenant.id):
            for difficulty, count in (
                (QuestionDifficulty.EASY, easy),
                (QuestionDifficulty.MEDIUM, medium),
                (QuestionDifficulty.HARD, hard),
            ):
                for _ in range(count):
                    self.question(difficulty=difficulty, topic=topic)


class BankConstraintTests(QuestionBankTestCase):
    def test_two_banks_cannot_share_a_name_within_a_subject(self) -> None:
        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            self.assertRaises(IntegrityError),
        ):
            QuestionBankFactory(tenant=self.tenant, subject=self.subject, name=self.bank.name)

    def test_the_same_name_under_another_subject_is_fine(self) -> None:
        """ "Term revision" is a reasonable bank name for every subject."""
        with tenant_context(self.tenant.id):
            other = SubjectFactory(tenant=self.tenant)
            bank = QuestionBankFactory(tenant=self.tenant, subject=other, name=self.bank.name)

        self.assertEqual(bank.name, self.bank.name)

    def test_a_bank_with_no_class_covers_every_level(self) -> None:
        """Null means every level — the same reading `Period.campus` uses. A
        general-knowledge bank is not wrong for having no year group."""
        with tenant_context(self.tenant.id):
            bank = QuestionBankFactory(tenant=self.tenant, subject=self.subject, school_class=None)

        self.assertIsNone(bank.school_class_id)


class QuestionConstraintTests(QuestionBankTestCase):
    def test_an_mcq_without_options_is_refused(self) -> None:
        """A multiple-choice question with no choices is not a question, and a
        paper assembled from one would print a stem with nothing under it."""
        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            self.assertRaises(IntegrityError),
        ):
            self.question(question_type=QuestionType.MCQ, options=None)

    def test_an_mcq_with_options_is_accepted(self) -> None:
        with tenant_context(self.tenant.id):
            question = self.question(
                question_type=QuestionType.MCQ, options=["Paris", "Rome", "Madrid"]
            )

        self.assertEqual(len(question.options), 3)

    def test_a_short_answer_question_needs_no_options(self) -> None:
        """The control: the constraint must not demand choices from a type that
        has none."""
        with tenant_context(self.tenant.id):
            question = self.question(question_type=QuestionType.SHORT_ANSWER)

        self.assertIsNone(question.options)

    def test_zero_marks_is_refused(self) -> None:
        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            self.assertRaises(IntegrityError),
        ):
            self.question(default_marks=Decimal("0.00"))

    def test_an_approved_ai_question_must_name_its_approver(self) -> None:
        """§7.2 makes this the gate AI output passes through, so the signature
        is the point."""
        with (
            tenant_context(self.tenant.id),
            transaction.atomic(),
            self.assertRaises(IntegrityError),
        ):
            self.question(source=QuestionSource.AI_GENERATED, is_approved=True, approved_by=None)

    def test_an_approved_manual_question_needs_no_approver(self) -> None:
        """The scoping *is* the rule. `is_approved=True` on a manual question
        means "no approval was needed" — a teacher writing it has already
        exercised the judgement — so demanding an approver there would block
        ordinary creation for no safeguard."""
        with tenant_context(self.tenant.id):
            question = self.question(source=QuestionSource.MANUAL, is_approved=True)

        self.assertTrue(question.is_approved)
        self.assertIsNone(question.approved_by)


class ApprovalGateTests(QuestionBankTestCase):
    def test_a_manual_question_is_created_approved(self) -> None:
        response = self.client.post(
            f"{BANKS}/{self.bank.pk}/questions",
            {
                "question_text": "Name the capital of France.",
                "question_type": QuestionType.SHORT_ANSWER,
                "difficulty": QuestionDifficulty.EASY,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        self.assertTrue(response.json()["data"]["is_approved"])

    def test_an_ai_question_is_created_unapproved_whatever_the_client_sent(self) -> None:
        """AGENTS.md invariant 5. `is_approved` is read-only on the serializer,
        and `create` forces False for an AI draft — belt and braces, because a
        pre-approved AI question is the whole gate defeated."""
        response = self.client.post(
            f"{BANKS}/{self.bank.pk}/questions",
            {
                "question_text": "Drafted by a model.",
                "question_type": QuestionType.SHORT_ANSWER,
                "source": QuestionSource.AI_GENERATED,
                "is_approved": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        self.assertFalse(response.json()["data"]["is_approved"])

    def test_approving_an_ai_question_records_who_approved_it(self) -> None:
        with tenant_context(self.tenant.id):
            question = self.question(source=QuestionSource.AI_GENERATED, is_approved=False)

        response = self.client.post(f"{BANKS}/{self.bank.pk}/questions/{question.pk}:approve")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            question.refresh_from_db()
        self.assertTrue(question.is_approved)
        self.assertEqual(question.approved_by, self.user.pk)

    def test_approving_twice_is_a_retry(self) -> None:
        with tenant_context(self.tenant.id):
            question = self.question(source=QuestionSource.AI_GENERATED, is_approved=False)
        self.client.post(f"{BANKS}/{self.bank.pk}/questions/{question.pk}:approve")

        response = self.client.post(f"{BANKS}/{self.bank.pk}/questions/{question.pk}:approve")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())

    def test_approving_a_manual_question_is_refused(self) -> None:
        """There is nothing to approve, and offering the action would suggest a
        gate that is not there."""
        with tenant_context(self.tenant.id):
            question = self.question(source=QuestionSource.MANUAL)

        response = self.client.post(f"{BANKS}/{self.bank.pk}/questions/{question.pk}:approve")

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertIn("Only AI-generated questions", str(response.json()))

    def test_approving_needs_the_approve_key(self) -> None:
        with tenant_context(self.tenant.id):
            question = self.question(source=QuestionSource.AI_GENERATED, is_approved=False)
            author = UserFactory(tenant=self.tenant)
        grant(
            author,
            "exams.question-bank.view",
            "exams.question-bank.create",
            "exams.question-bank.update",
            scope=RecordScope.ALL,
        )
        client = APIClient()
        authenticate(client, author)

        response = client.post(f"{BANKS}/{self.bank.pk}/questions/{question.pk}:approve")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class BlueprintTests(QuestionBankTestCase):
    def blueprint(self, **overrides) -> dict:
        section = {"difficulty": QuestionDifficulty.EASY, "count": 2}
        section.update(overrides)
        return {"title": "Term 1 Paper", "sections": [section]}

    def test_a_satisfiable_blueprint_returns_202_and_a_job(self) -> None:
        self.stock(easy=3)

        response = self.client.post(
            f"{BANKS}/{self.bank.pk}:assemble-paper", self.blueprint(), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        self.assertIn("job_id", response.json()["data"])

    def test_every_shortfall_is_reported_at_once(self) -> None:
        """A teacher whose blueprint asks for eight hard questions from a bank
        holding three needs to know that about each section of the paper, not to
        fix one and resubmit."""
        self.stock(easy=1)

        response = self.client.post(
            f"{BANKS}/{self.bank.pk}:assemble-paper",
            {
                "title": "Paper",
                "sections": [
                    {"difficulty": QuestionDifficulty.EASY, "count": 5},
                    {"difficulty": QuestionDifficulty.HARD, "count": 8},
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        sections = response.json()["error"]["meta"]["sections"]
        self.assertEqual(len(sections), 2)
        self.assertEqual(sections[0]["requested"], 5)
        self.assertEqual(sections[0]["available"], 1)

    def test_an_unapproved_question_does_not_count_toward_the_pool(self) -> None:
        """Counting it would make a blueprint look satisfiable and then
        assemble a paper that is short."""
        with tenant_context(self.tenant.id):
            for _ in range(3):
                self.question(
                    difficulty=QuestionDifficulty.EASY,
                    source=QuestionSource.AI_GENERATED,
                    is_approved=False,
                )
            shortfalls = services.assert_blueprint_is_satisfiable(
                bank=self.bank,
                sections=[{"difficulty": QuestionDifficulty.EASY, "count": 2}],
            )

        self.assertEqual(len(shortfalls), 1)
        self.assertEqual(shortfalls[0]["available"], 0)

    def test_a_topic_section_draws_only_from_that_topic(self) -> None:
        self.stock(easy=3)
        self.stock(easy=1, topic="Algebra")

        with tenant_context(self.tenant.id):
            shortfalls = services.assert_blueprint_is_satisfiable(
                bank=self.bank,
                sections=[{"difficulty": QuestionDifficulty.EASY, "count": 2, "topic": "Algebra"}],
            )

        self.assertEqual(len(shortfalls), 1)
        self.assertEqual(shortfalls[0]["available"], 1)

    def test_a_section_with_no_topic_draws_from_every_topic(self) -> None:
        self.stock(easy=2)
        self.stock(easy=2, topic="Algebra")

        with tenant_context(self.tenant.id):
            shortfalls = services.assert_blueprint_is_satisfiable(
                bank=self.bank,
                sections=[{"difficulty": QuestionDifficulty.EASY, "count": 4}],
            )

        self.assertEqual(shortfalls, [])


class SelectionTests(QuestionBankTestCase):
    def test_selection_is_deterministic(self) -> None:
        """Two runs of the same blueprint over an unchanged bank produce the
        same paper — a teacher who regenerates after fixing a typo should not
        get a different exam."""
        self.stock(easy=5)
        sections = [{"difficulty": QuestionDifficulty.EASY, "count": 3}]

        with tenant_context(self.tenant.id):
            first = services.select_paper_questions(bank=self.bank, sections=sections)
            second = services.select_paper_questions(bank=self.bank, sections=sections)

        self.assertEqual(
            [q.pk for q in first[0]["questions"]],
            [q.pk for q in second[0]["questions"]],
        )

    def test_the_least_used_questions_are_chosen_first(self) -> None:
        """Spreads reuse across a bank, which is what makes §6's usage tracking
        worth keeping."""
        self.stock(easy=3)
        with tenant_context(self.tenant.id):
            heavily_used = Question.objects.alive().filter(question_bank=self.bank).first()
            heavily_used.usage_count = 10
            heavily_used.save(update_fields=["usage_count"])

            chosen = services.select_paper_questions(
                bank=self.bank,
                sections=[{"difficulty": QuestionDifficulty.EASY, "count": 2}],
            )

        self.assertNotIn(heavily_used.pk, [q.pk for q in chosen[0]["questions"]])

    def test_a_question_is_never_used_twice_in_one_paper(self) -> None:
        """A paper with the same question twice is a paper somebody has to
        reprint."""
        self.stock(easy=4)

        with tenant_context(self.tenant.id):
            chosen = services.select_paper_questions(
                bank=self.bank,
                sections=[
                    {"difficulty": QuestionDifficulty.EASY, "count": 2},
                    {"difficulty": QuestionDifficulty.EASY, "count": 2},
                ],
            )

        picked = [q.pk for section in chosen for q in section["questions"]]
        self.assertEqual(len(picked), len(set(picked)))

    def test_usage_is_recorded_in_one_update(self) -> None:
        self.stock(easy=2)
        with tenant_context(self.tenant.id):
            questions = list(Question.objects.alive().filter(question_bank=self.bank))

            services.record_paper_usage(questions=questions, actor_id=self.user.pk)
            counts = set(
                Question.objects.alive()
                .filter(question_bank=self.bank)
                .values_list("usage_count", flat=True)
            )

        self.assertEqual(counts, {1})

    def test_usage_count_is_not_settable_through_the_api(self) -> None:
        """It is the only record that a question reached a paper (§15 gives
        assembled papers no table), so nothing but assembly may write it."""
        with tenant_context(self.tenant.id):
            question = self.question()

        response = self.client.patch(
            f"{BANKS}/{self.bank.pk}/questions/{question.pk}",
            {"usage_count": 99},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            question.refresh_from_db()
        self.assertEqual(question.usage_count, 0)


class PaperDocumentTests(QuestionBankTestCase):
    def test_an_mcq_prints_its_options_and_others_do_not(self) -> None:
        """A short-answer question printed with lettered choices under it is a
        paper that confuses a hall of students."""
        with tenant_context(self.tenant.id):
            mcq = self.question(
                question_type=QuestionType.MCQ,
                question_text="Capital of France?",
                options=["Paris", "Rome"],
            )
            short = self.question(
                question_type=QuestionType.SHORT_ANSWER, question_text="Explain gravity."
            )
            html = documents.exam_paper_html(
                bank=self.bank,
                sections=[
                    {"title": "Section A", "questions": [mcq], "marks_each": None},
                    {"title": "Section B", "questions": [short], "marks_each": None},
                ],
                title="Term 1 Paper",
                total_marks=Decimal("4.00"),
                school_name="Test School",
            )

        self.assertIn("Paris", html)
        self.assertIn('class="options"', html)
        self.assertIn("Explain gravity.", html)

    def test_question_text_is_escaped(self) -> None:
        with tenant_context(self.tenant.id):
            question = self.question(question_text="Is 3 < 5 & 4 > 2?")
            html = documents.exam_paper_html(
                bank=self.bank,
                sections=[{"title": "A", "questions": [question], "marks_each": None}],
                title="Paper",
                total_marks=Decimal("2.00"),
                school_name="Test School",
            )

        self.assertNotIn("3 < 5 & 4 > 2", html)
        self.assertIn("3 &lt; 5 &amp; 4 &gt; 2", html)

    def test_a_section_marks_override_beats_the_question_default(self) -> None:
        with tenant_context(self.tenant.id):
            question = self.question(default_marks=Decimal("2.00"))
            html = documents.exam_paper_html(
                bank=self.bank,
                sections=[
                    {
                        "title": "A",
                        "questions": [question],
                        "marks_each": Decimal("5.00"),
                    }
                ],
                title="Paper",
                total_marks=Decimal("5.00"),
                school_name="Test School",
            )

        self.assertIn("[5.00]", html)


class BankScopeTests(QuestionBankTestCase):
    def test_a_teacher_sees_only_banks_for_subjects_they_teach(self) -> None:
        """§4's "(assigned subject)" parenthetical, resolved through
        `academics.TeacherSubjectAllocation`."""
        with tenant_context(self.tenant.id):
            stranger_subject = SubjectFactory(tenant=self.tenant)
            QuestionBankFactory(tenant=self.tenant, subject=stranger_subject)
        grant(
            self.subject_teacher_user,
            "exams.question-bank.view",
            scope=RecordScope.ASSIGNED,
        )
        client = APIClient()
        authenticate(client, self.subject_teacher_user)

        response = client.get(BANKS)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        ids = {row["id"] for row in response.json()["data"]}
        self.assertEqual(ids, {str(self.bank.pk)})

    def test_a_restricted_principal_reaches_nothing_here(self) -> None:
        """§4 grants no portal role a question-bank key, and a bank holds answer
        keys — so this viewset is staff-only on every action rather than
        carving out a readable set."""
        with tenant_context(self.tenant.id):
            student_user = UserFactory(tenant=self.tenant)
        grant(
            student_user,
            "exams.question-bank.view",
            scope=RecordScope.ALL,
            is_restricted_principal=True,
        )
        client = APIClient()
        authenticate(client, student_user)

        self.assertEqual(client.get(BANKS).status_code, status.HTTP_403_FORBIDDEN)

    def test_questions_under_a_foreign_bank_are_a_404(self) -> None:
        from apps.examinations.tests.factories import TenantFactory

        other_tenant = TenantFactory()
        with tenant_context(other_tenant.id):
            foreign_subject = SubjectFactory(tenant=other_tenant)
            foreign_bank = QuestionBankFactory(tenant=other_tenant, subject=foreign_subject)

        response = self.client.get(f"{BANKS}/{foreign_bank.pk}/questions")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class AssembleGuardTests(QuestionBankTestCase):
    def test_assembly_needs_the_update_key(self) -> None:
        self.stock(easy=2)
        with tenant_context(self.tenant.id):
            viewer = UserFactory(tenant=self.tenant)
        grant(viewer, "exams.question-bank.view", scope=RecordScope.ALL)
        client = APIClient()
        authenticate(client, viewer)

        response = client.post(
            f"{BANKS}/{self.bank.pk}:assemble-paper",
            {"title": "P", "sections": [{"difficulty": QuestionDifficulty.EASY, "count": 1}]},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_an_empty_blueprint_is_refused(self) -> None:
        response = self.client.post(
            f"{BANKS}/{self.bank.pk}:assemble-paper",
            {"title": "P", "sections": []},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_approving_a_question_is_refused_for_a_missing_source(self) -> None:
        with tenant_context(self.tenant.id):
            question = self.question(source=QuestionSource.IMPORTED)

            with self.assertRaises(Conflict):
                services.assert_question_is_approvable(question)


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


class AssemblyShortfallTests(QuestionBankTestCase):
    """PR #54's review, Major 2 — selection sliced silently and took no lock.

    The endpoint's satisfiability check runs synchronously; selection runs later
    in the job's transaction. Between the two a concurrent assembly can take the
    questions or someone can unapprove one — and the original
    `candidates[:count]` produced a **short exam paper** with the job marked
    succeeded. Nobody notices until a hall of students has a paper missing its
    last section.
    """

    def test_a_pool_that_shrank_after_the_check_fails_rather_than_truncating(self) -> None:
        self.stock(easy=2)
        sections = [{"difficulty": QuestionDifficulty.EASY, "count": 2}]

        with tenant_context(self.tenant.id):
            # The blueprint was satisfiable when the endpoint checked it.
            self.assertEqual(
                services.assert_blueprint_is_satisfiable(bank=self.bank, sections=sections),
                [],
            )
            # Then someone unapproves one, exactly as could happen between the
            # request and the worker picking it up.
            victim = Question.objects.alive().filter(question_bank=self.bank).first()
            victim.is_approved = False
            victim.save(update_fields=["is_approved"])

            with self.assertRaises(DomainRuleViolation) as caught:
                services.select_paper_questions(bank=self.bank, sections=sections)

        message = str(caught.exception.detail)
        self.assertIn("only 1 approved question(s) were available", message)
        self.assertIn("re-check it and try again", message)

    def test_the_message_names_the_section_and_its_topic(self) -> None:
        """A teacher with a five-section blueprint needs to know which one."""
        self.stock(easy=1)

        with (
            tenant_context(self.tenant.id),
            self.assertRaises(DomainRuleViolation) as caught,
        ):
            services.select_paper_questions(
                bank=self.bank,
                sections=[
                    {"difficulty": QuestionDifficulty.EASY, "count": 1},
                    {"difficulty": QuestionDifficulty.HARD, "count": 3, "topic": "Calculus"},
                ],
            )

        message = str(caught.exception.detail)
        self.assertIn("Section 2", message)
        self.assertIn("Calculus", message)

    def test_selection_locks_the_candidate_rows(self) -> None:
        """A genuine race is not reproducible in a single-connection
        `TestCase`, so this asserts the mechanism — the same approach the
        result-lifecycle lock tests take."""
        import inspect

        self.assertIn("select_for_update()", inspect.getsource(services.select_paper_questions))

    def test_an_exactly_sufficient_pool_still_assembles(self) -> None:
        """The control: the re-check must not reject a blueprint that fits
        precisely, which is the common case for a small bank."""
        self.stock(easy=2)

        with tenant_context(self.tenant.id):
            chosen = services.select_paper_questions(
                bank=self.bank,
                sections=[{"difficulty": QuestionDifficulty.EASY, "count": 2}],
            )

        self.assertEqual(len(chosen[0]["questions"]), 2)

    def test_the_job_records_the_shortfall_as_a_failure(self) -> None:
        """A short paper marked succeeded is the outcome this exists to
        prevent, so the job has to carry the error a teacher can act on."""
        from apps.examinations import tasks
        from core.jobs.models import JobStatus
        from core.jobs.services import create_job

        self.stock(easy=1)
        with tenant_context(self.tenant.id):
            job = create_job(
                tenant_id=self.tenant.pk,
                job_type="exams.assemble-paper",
                payload={
                    "question_bank_id": str(self.bank.pk),
                    "title": "Term 1 Paper",
                    "sections": [
                        {"difficulty": QuestionDifficulty.EASY, "count": 5, "marks_each": None}
                    ],
                    "requested_by": str(self.user.pk),
                },
                actor_id=self.user.pk,
            )

        tasks.assemble_paper_task(
            tenant_id=str(self.tenant.pk),
            job_id=str(job.pk),
            actor_id=str(self.user.pk),
        )

        with tenant_context(self.tenant.id):
            job.refresh_from_db()
        self.assertEqual(job.status, JobStatus.FAILED)
        self.assertIn("approved question(s) were available", job.error)
