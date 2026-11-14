"""`source` is create-only: a PATCH cannot remove an AI draft's label.

ai-governance.md §8 keeps the AI label on a question for good, and §7.2's gate
keys on it: a draft re-labelled `manual` would read as a teacher's own work.
"""

from __future__ import annotations

from rest_framework import status

from apps.examinations.models import QuestionSource
from apps.examinations.tests.test_question_banks import BANKS, QuestionBankTestCase
from core.tenancy.context import tenant_context


class QuestionSourceLockTests(QuestionBankTestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.draft = self.question(source=QuestionSource.AI_GENERATED, is_approved=False)
        self.url = f"{BANKS}/{self.bank.pk}/questions/{self.draft.pk}"

    def test_changing_the_source_on_update_is_refused(self) -> None:
        response = self.client.patch(self.url, {"source": QuestionSource.MANUAL}, format="json")

        self.assertEqual(
            response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY, response.json()
        )
        self.assertEqual(response.json()["error"]["details"][0]["field"], "source")
        with tenant_context(self.tenant.id):
            self.draft.refresh_from_db()
        self.assertEqual(self.draft.source, QuestionSource.AI_GENERATED)
        self.assertFalse(self.draft.is_approved)

    def test_resending_the_same_source_is_accepted(self) -> None:
        """The control: a client that echoes the record back is not changing it."""
        response = self.client.patch(
            self.url, {"source": QuestionSource.AI_GENERATED, "topic": "Primes"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["source"], QuestionSource.AI_GENERATED)
