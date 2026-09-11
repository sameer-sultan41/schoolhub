"""`/terms` endpoint tests (module doc §5.4, §16)."""

from __future__ import annotations

from rest_framework import status

from apps.school_organization.tests.base import SchoolOrganizationAPITestCase
from apps.school_organization.tests.factories import AcademicSessionFactory, TermFactory
from core.tenancy.context import tenant_context


class TermEndpointTests(SchoolOrganizationAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.session = AcademicSessionFactory(tenant=self.tenant)

    def test_create_rejects_dates_outside_the_session_window(self) -> None:
        self.allow("school.academic-session.view", "school.academic-session.create")
        response = self.client.post(
            "/api/v1/terms",
            {
                "academic_session_id": str(self.session.pk),
                "name": "Term 1",
                "sequence": 1,
                "start_date": "2025-01-01",
                "end_date": "2025-06-01",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_create_accepts_a_term_inside_the_window(self) -> None:
        self.allow("school.academic-session.view", "school.academic-session.create")
        response = self.client.post(
            "/api/v1/terms",
            {
                "academic_session_id": str(self.session.pk),
                "name": "Term 1",
                "sequence": 1,
                "start_date": "2026-04-01",
                "end_date": "2026-08-31",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_list_filters_by_session(self) -> None:
        self.allow("school.academic-session.view")
        with tenant_context(self.tenant.id):
            TermFactory(tenant=self.tenant, academic_session=self.session)

        response = self.client.get(f"/api/v1/terms?academic_session_id={self.session.pk}")

        self.assertEqual(len(response.json()["data"]), 1)
