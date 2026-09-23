"""`/academic-sessions` endpoint tests (module doc §5.4, §7, §16).

Paths are written out literally rather than reversed: the URL shape *is* the
contract (``/api/v1/academic-sessions/{id}:activate``), and a test that
reverses the name would keep passing after the contract broke.
"""

from __future__ import annotations

from rest_framework import status

from apps.school_organization.models import AcademicSession, ClassSubject, SessionStatus
from apps.school_organization.tests.base import SchoolOrganizationAPITestCase
from apps.school_organization.tests.factories import (
    SESSION_END,
    SESSION_START,
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    SectionFactory,
    SubjectFactory,
    TermFactory,
)
from core.tenancy.context import tenant_context


class AcademicSessionEndpointTests(SchoolOrganizationAPITestCase):
    def _complete_structure(self) -> AcademicSession:
        with tenant_context(self.tenant.id):
            campus = CampusFactory(tenant=self.tenant)
            grade = ClassFactory(tenant=self.tenant)
            SectionFactory(tenant=self.tenant, school_class=grade, campus=campus)
            session = AcademicSessionFactory(tenant=self.tenant)
            TermFactory(
                tenant=self.tenant,
                academic_session=session,
                start_date=SESSION_START,
                end_date=SESSION_END,
            )
        return session

    def test_status_cannot_be_set_through_a_plain_patch(self) -> None:
        self.allow("school.academic-session.view", "school.academic-session.update")
        with tenant_context(self.tenant.id):
            session = AcademicSessionFactory(tenant=self.tenant)

        response = self.client.patch(
            f"/api/v1/academic-sessions/{session.pk}",
            {"status": SessionStatus.ACTIVE, "is_current": True},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        session.refresh_from_db()
        self.assertEqual(session.status, SessionStatus.PLANNED)
        self.assertFalse(session.is_current)

    def test_create_rejects_overlapping_dates(self) -> None:
        self.allow("school.academic-session.view", "school.academic-session.create")
        with tenant_context(self.tenant.id):
            AcademicSessionFactory(tenant=self.tenant)

        response = self.client.post(
            "/api/v1/academic-sessions",
            {"name": "Overlapping", "start_date": "2026-06-01", "end_date": "2027-06-01"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_activate_requires_its_own_permission(self) -> None:
        self.allow("school.academic-session.view", "school.academic-session.update")
        session = self._complete_structure()

        response = self.client.post(f"/api/v1/academic-sessions/{session.pk}:activate")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_activate_rejects_an_incomplete_structure(self) -> None:
        self.allow("school.academic-session.view", "school.academic-session.activate")
        with tenant_context(self.tenant.id):
            session = AcademicSessionFactory(tenant=self.tenant)

        response = self.client.post(f"/api/v1/academic-sessions/{session.pk}:activate")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        session.refresh_from_db()
        self.assertEqual(session.status, SessionStatus.PLANNED)

    def test_activate_flips_the_session_current(self) -> None:
        self.allow("school.academic-session.view", "school.academic-session.activate")
        session = self._complete_structure()

        response = self.client.post(f"/api/v1/academic-sessions/{session.pk}:activate")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["data"]["status"], SessionStatus.ACTIVE)
        session.refresh_from_db()
        self.assertTrue(session.is_current)

    def test_close_locks_the_session(self) -> None:
        self.allow(
            "school.academic-session.view",
            "school.academic-session.activate",
            "school.academic-session.close",
        )
        session = self._complete_structure()
        self.client.post(f"/api/v1/academic-sessions/{session.pk}:activate")

        response = self.client.post(f"/api/v1/academic-sessions/{session.pk}:close")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        session.refresh_from_db()
        self.assertEqual(session.status, SessionStatus.CLOSED)
        self.assertFalse(session.is_current)

    def test_closing_a_planned_session_is_a_conflict(self) -> None:
        self.allow("school.academic-session.view", "school.academic-session.close")
        with tenant_context(self.tenant.id):
            session = AcademicSessionFactory(tenant=self.tenant)

        response = self.client.post(f"/api/v1/academic-sessions/{session.pk}:close")

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_clone_copies_the_curriculum_into_a_new_session(self) -> None:
        self.allow("school.academic-session.view", "school.academic-session.create")
        with tenant_context(self.tenant.id):
            source = AcademicSessionFactory(tenant=self.tenant)
            grade = ClassFactory(tenant=self.tenant)
            subject = SubjectFactory(tenant=self.tenant)
            ClassSubject.objects.create(
                tenant=self.tenant,
                academic_session=source,
                school_class=grade,
                subject=subject,
                weekly_periods=6,
            )

        response = self.client.post(
            f"/api/v1/academic-sessions/{source.pk}:clone",
            {"name": "2028-29", "start_date": "2028-04-01", "end_date": "2029-03-31"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        target_id = response.json()["data"]["id"]

        with tenant_context(self.tenant.id):
            cloned = ClassSubject.objects.filter(academic_session_id=target_id)
            self.assertEqual(cloned.count(), 1)
            self.assertEqual(cloned.first().weekly_periods, 6)
