"""Tests for GET /api/v1/jobs/{id}."""

from __future__ import annotations

from rest_framework import status
from rest_framework.test import APITestCase

from apps.school_organization.tests.factories import TenantFactory, UserFactory, authenticate, grant
from core.jobs.tests.factories import BackgroundJobFactory
from core.tenancy.context import tenant_context


class JobViewSetTests(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)
        grant(self.user, "platform.job.view")

    def test_the_creator_can_retrieve_their_own_job(self) -> None:
        with tenant_context(self.tenant.id):
            job = BackgroundJobFactory(tenant=self.tenant, created_by=self.user.pk)

        response = self.client.get(f"/api/v1/jobs/{job.pk}")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["status"], "queued")

    def test_a_job_created_by_someone_else_is_404(self) -> None:
        other_user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            job = BackgroundJobFactory(tenant=self.tenant, created_by=other_user.pk)

        response = self.client.get(f"/api/v1/jobs/{job.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_job_in_another_tenant_is_404(self) -> None:
        other_tenant = TenantFactory()
        other_user = UserFactory(tenant=other_tenant)
        with tenant_context(other_tenant.id):
            job = BackgroundJobFactory(tenant=other_tenant, created_by=other_user.pk)

        response = self.client.get(f"/api/v1/jobs/{job.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_retrieve_without_the_permission_key_is_403(self) -> None:
        unpermitted_user = UserFactory(tenant=self.tenant)
        authenticate(self.client, unpermitted_user)
        with tenant_context(self.tenant.id):
            job = BackgroundJobFactory(tenant=self.tenant, created_by=unpermitted_user.pk)

        response = self.client.get(f"/api/v1/jobs/{job.pk}")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
