"""Sign-in and token refresh refuse a suspended or deleted school.

The data views refuse such a tenant under a bearer token (`TenantScopedViewSetMixin`), but
a user who could still sign in or refresh would keep minting access tokens for a dashboard
where every screen errors. Both entry points apply `core.tenancy.access`'s rule.
"""

from __future__ import annotations

from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.school_organization.tests.factories import TEST_PASSWORD, TenantFactory, UserFactory
from core.rbac.views import REFRESH_COOKIE_NAME
from core.tenancy.access import user_may_authenticate
from core.tenancy.models import Tenant, TenantStatus

LOGIN = "/api/v1/auth/login"
REFRESH = "/api/v1/auth/refresh"


class SignInTenantStatusTests(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)

    def login(self):
        return self.client.post(
            LOGIN, {"identifier": self.user.email, "password": TEST_PASSWORD}, format="json"
        )

    def suspend(self) -> None:
        Tenant.objects.filter(pk=self.tenant.pk).update(status=TenantStatus.SUSPENDED)

    def test_an_operational_school_signs_in(self):
        self.assertEqual(self.login().status_code, status.HTTP_200_OK)

    def test_a_suspended_school_cannot_sign_in(self):
        self.suspend()

        response = self.login()

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("suspended", response.json()["error"]["message"])
        self.assertNotIn(REFRESH_COOKIE_NAME, response.cookies)

    def test_a_deleted_school_cannot_sign_in(self):
        Tenant.objects.filter(pk=self.tenant.pk).update(deleted_at=timezone.now())

        response = self.login()

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_refresh_stops_once_the_school_is_suspended_and_clears_the_cookie(self):
        """Signed in before the suspension, the refresh cookie must not keep minting tokens."""
        self.assertEqual(self.login().status_code, status.HTTP_200_OK)
        self.suspend()

        response = self.client.post(REFRESH)

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(response.cookies[REFRESH_COOKIE_NAME].value, "")

    def test_refresh_still_works_for_an_operational_school(self):
        self.assertEqual(self.login().status_code, status.HTTP_200_OK)

        response = self.client.post(REFRESH)

        self.assertEqual(response.status_code, status.HTTP_200_OK)


class UserAuthenticationRuleTests(APITestCase):
    def test_a_platform_user_with_no_tenant_is_judged_on_is_active_alone(self):
        user = UserFactory(tenant=None)

        self.assertTrue(user_may_authenticate(user))
        user.is_active = False
        self.assertFalse(user_may_authenticate(user))

    def test_none_is_refused(self):
        self.assertFalse(user_may_authenticate(None))
