"""`GET /ai/usage` and `POST /ai/requests/{id}:feedback`, including cross-tenant 404s."""

from __future__ import annotations

from rest_framework import status
from rest_framework.test import APITestCase

from apps.school_organization.tests.factories import TenantFactory, UserFactory, authenticate, grant
from core.ai.models import AIRequestFeedback
from core.ai.tests.base import set_budget, spend
from core.tenancy.context import tenant_context


class AIUsageTests(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)

    def test_usage_is_tenant_scoped_and_keyed(self) -> None:
        with self.subTest("the key is required"):
            response = self.client.get("/api/v1/ai/usage")
            self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

        grant(self.user, "ai.usage.view")
        set_budget(self.tenant, 5000)
        spend(self.tenant, self.user.pk, 100, feature_key="fees.report-summary")
        spend(self.tenant, self.user.pk, 50, feature_key="fees.report-summary", cache_read=5)
        spend(self.tenant, self.user.pk, 30, feature_key="ai.test-probe")
        other = TenantFactory()
        spend(other, UserFactory(tenant=other).pk, 9999, feature_key="fees.report-summary")

        response = self.client.get("/api/v1/ai/usage")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(
            response.json()["data"],
            {
                "month_tokens": 185,
                "monthly_limit": 5000,
                "by_feature": [
                    {"feature_key": "ai.test-probe", "tokens": 30, "requests": 1},
                    {"feature_key": "fees.report-summary", "tokens": 155, "requests": 2},
                ],
            },
        )


class AIFeedbackTests(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)
        grant(self.user, "ai.feedback.create")
        self.ai_request = spend(self.tenant, self.user.pk, 10)

    def url(self, pk: object) -> str:
        return f"/api/v1/ai/requests/{pk}:feedback"

    def test_feedback_is_recorded_once(self) -> None:
        response = self.client.post(
            self.url(self.ai_request.pk), {"value": 1, "comment": "Useful."}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        body = response.json()["data"]
        self.assertEqual(body["ai_request_id"], str(self.ai_request.pk))
        self.assertEqual((body["value"], body["comment"]), (1, "Useful."))
        with tenant_context(self.tenant.id):
            feedback = AIRequestFeedback.objects.get()
        self.assertEqual(feedback.user_id, self.user.pk)

    def test_feedback_requires_the_key(self) -> None:
        stranger = UserFactory(tenant=self.tenant)
        authenticate(self.client, stranger)
        ai_request = spend(self.tenant, stranger.pk, 10)

        response = self.client.post(self.url(ai_request.pk), {"value": 1}, format="json")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_feedback_value_must_be_a_thumb(self) -> None:
        response = self.client.post(self.url(self.ai_request.pk), {"value": 5}, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_feedback_only_on_own_request(self) -> None:
        colleague = UserFactory(tenant=self.tenant)
        theirs = spend(self.tenant, colleague.pk, 10)

        response = self.client.post(self.url(theirs.pk), {"value": -1}, format="json")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_second_feedback_is_409(self) -> None:
        first = self.client.post(self.url(self.ai_request.pk), {"value": 1}, format="json")
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)

        second = self.client.post(self.url(self.ai_request.pk), {"value": -1}, format="json")

        self.assertEqual(second.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(second.json()["error"]["code"], "conflict")

    def test_other_tenants_request_feedback_is_404(self) -> None:
        other = TenantFactory()
        theirs = spend(other, UserFactory(tenant=other).pk, 10)

        response = self.client.post(self.url(theirs.pk), {"value": 1}, format="json")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
