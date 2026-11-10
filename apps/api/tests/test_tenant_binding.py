"""The tenant must bind from the API's own authentication, not from a session.

Production clients send a bearer token and nothing else. Django's session-based
``request.user`` is therefore anonymous while middleware runs, so anything that
resolves the tenant there sees no user and binds nothing. A test that logs in via
``force_login`` would never notice: it creates the session that production lacks.

These tests deliberately authenticate with the token alone.
"""

from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from apps.fees_finance.tests.factories import StudentFactory, enable_feature
from apps.school_organization.models import Campus
from apps.school_organization.tests.factories import (
    CampusFactory,
    TenantFactory,
    UserFactory,
    grant,
)
from core.jobs.models import BackgroundJob
from core.tenancy.context import tenant_context


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


class JWTOnlyFinanceReportTests(APITestCase):
    """The finance report views are plain `APIView`s; under a bearer token alone they must
    still bind the caller's tenant, or `RequiresModuleFeature` sees none and refuses."""

    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        enable_feature(self.tenant, "module.fees_finance")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(self.user)}")

    def test_the_finance_summary_report_is_served_under_a_token(self):
        grant(self.user, "fees.report.view")

        response = self.client.get(
            "/api/v1/reports/finance-summary",
            {"kind": "collection", "date_from": "2026-01-01", "date_to": "2026-01-31"},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())

    def test_a_finance_report_export_is_queued_under_a_token(self):
        grant(self.user, "fees.report.view", "fees.report.export")

        response = self.client.post(
            "/api/v1/reports/finance-summary",
            {"kind": "collection", "date_from": "2026-01-01", "date_to": "2026-01-31"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        with tenant_context(self.tenant.id):
            self.assertTrue(BackgroundJob.objects.filter(tenant_id=self.tenant.id).exists())

    def test_a_student_ledger_is_served_under_a_token(self):
        grant(self.user, "fees.invoice.view")
        with tenant_context(self.tenant.id):
            student = StudentFactory(tenant=self.tenant, campus=CampusFactory(tenant=self.tenant))

        response = self.client.get(f"/api/v1/students/{student.pk}/ledger")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
