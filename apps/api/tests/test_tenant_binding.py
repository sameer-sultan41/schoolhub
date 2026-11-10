"""The tenant must bind from the API's own authentication, not from a session.

Production clients send a bearer token and nothing else. Django's session-based
``request.user`` is therefore anonymous while middleware runs, so anything that
resolves the tenant there sees no user and binds nothing. A test that logs in via
``force_login`` would never notice: it creates the session that production lacks.

These tests deliberately authenticate with the token alone.
"""

from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from apps.school_organization.models import Campus
from apps.school_organization.tests.factories import (
    CampusFactory,
    TenantFactory,
    UserFactory,
    grant,
)
from core.tenancy.context import tenant_context
from core.tenancy.models import Tenant, TenantStatus


class JWTOnlyTenantBindingTests(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        # Token only — no force_login, so there is no session to fall back on.
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(self.user)}")

    def test_reads_are_scoped_to_the_callers_tenant(self):
        grant(self.user, "school.campus.view")
        with tenant_context(self.tenant.id):
            CampusFactory(tenant=self.tenant, name="Ours")

        other = TenantFactory()
        with tenant_context(other.id):
            CampusFactory(tenant=other, name="Theirs")

        response = self.client.get("/api/v1/campuses")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        names = [row["name"] for row in response.json()["data"]]
        self.assertEqual(names, ["Ours"])

    def test_writes_are_stamped_with_the_callers_tenant(self):
        grant(self.user, "school.campus.view", "school.campus.create")

        response = self.client.post(
            "/api/v1/campuses", {"name": "North", "code": "N1"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        with tenant_context(self.tenant.id):
            campus = Campus.objects.get(code="N1")
        self.assertEqual(campus.tenant_id, self.tenant.id)

    def test_a_token_alone_cannot_reach_another_tenants_record(self):
        grant(self.user, "school.campus.view")
        other = TenantFactory()
        with tenant_context(other.id):
            theirs = CampusFactory(tenant=other)

        response = self.client.get(f"/api/v1/campuses/{theirs.pk}")

        # 404 rather than 403: a 403 would confirm the record exists.
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_suspended_schools_token_is_refused(self):
        """`TenantMiddleware` refuses a suspended tenant only when it can see the user,
        which under a bearer token it never can; the view must refuse it too."""
        grant(self.user, "school.campus.view")
        Tenant.objects.filter(pk=self.tenant.pk).update(status=TenantStatus.SUSPENDED)

        response = self.client.get("/api/v1/campuses")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.json()["error"]["code"], "tenant_suspended")

    def test_a_deleted_schools_token_is_refused(self):
        grant(self.user, "school.campus.view")
        Tenant.objects.filter(pk=self.tenant.pk).update(deleted_at=timezone.now())

        response = self.client.get("/api/v1/campuses")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.json()["error"]["code"], "tenant_not_found")

    def test_a_trial_or_past_due_school_is_still_served(self):
        grant(self.user, "school.campus.view")
        for operational in (TenantStatus.TRIAL, TenantStatus.PAST_DUE):
            with self.subTest(operational):
                Tenant.objects.filter(pk=self.tenant.pk).update(status=operational)

                response = self.client.get("/api/v1/campuses")

                self.assertEqual(response.status_code, status.HTTP_200_OK)
