"""API tests for the school-organization endpoints (module doc §16).

Paths are written out literally rather than reversed: the URL shape *is* the
contract (``/api/v1/campuses``, ``/api/v1/academic-sessions/{id}:activate``), and
a test that reverses the name would keep passing after the contract broke.
"""

from __future__ import annotations

import datetime

from rest_framework import status
from rest_framework.test import APITestCase

from apps.school_organization.models import (
    AcademicSession,
    Campus,
    ClassSubject,
    Section,
    SessionStatus,
)
from apps.school_organization.tests.factories import (
    SESSION_END,
    SESSION_START,
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    SectionFactory,
    SubjectFactory,
    TenantFactory,
    TermFactory,
    UserFactory,
    authenticate,
    grant,
)
from core.tenancy.context import tenant_context


class SchoolOrganizationAPITestCase(APITestCase):
    """Base fixture: one tenant, one authenticated staff user, no permissions yet."""

    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)

    def allow(self, *permission_keys: str) -> None:
        grant(self.user, *permission_keys)


class CampusEndpointTests(SchoolOrganizationAPITestCase):
    def test_create_requires_the_create_permission(self) -> None:
        self.allow("school.campus.view")
        response = self.client.post(
            "/api/v1/campuses", {"name": "North Campus", "code": "north"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_create_normalizes_the_code_and_stamps_the_tenant(self) -> None:
        self.allow("school.campus.view", "school.campus.create")
        response = self.client.post(
            "/api/v1/campuses",
            {"name": "North Campus", "code": " north ", "timezone": "Asia/Karachi"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.json()["data"]["code"], "NORTH")

        with tenant_context(self.tenant.id):
            campus = Campus.objects.get(code="NORTH")
        self.assertEqual(campus.tenant_id, self.tenant.id)
        self.assertEqual(campus.created_by, self.user.pk)

    def test_create_rejects_a_non_iana_timezone(self) -> None:
        self.allow("school.campus.view", "school.campus.create")
        response = self.client.post(
            "/api/v1/campuses",
            {"name": "North", "code": "N1", "timezone": "PKT"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.json()["error"]["code"], "validation_error")

    def test_list_is_filtered_by_is_active(self) -> None:
        self.allow("school.campus.view")
        with tenant_context(self.tenant.id):
            CampusFactory(tenant=self.tenant, is_active=True)
            CampusFactory(tenant=self.tenant, is_active=False)

        response = self.client.get("/api/v1/campuses?is_active=true")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.json()["data"]), 1)

    def test_list_excludes_soft_deleted_rows(self) -> None:
        self.allow("school.campus.view")
        with tenant_context(self.tenant.id):
            campus = CampusFactory(tenant=self.tenant)
            campus.deleted_at = datetime.datetime.now(tz=datetime.UTC)
            campus.save(update_fields=["deleted_at"])

        response = self.client.get("/api/v1/campuses")

        self.assertEqual(response.json()["data"], [])

    def test_promoting_a_primary_campus_demotes_the_incumbent(self) -> None:
        self.allow("school.campus.view", "school.campus.create")
        with tenant_context(self.tenant.id):
            incumbent = CampusFactory(tenant=self.tenant, is_primary=True)

        response = self.client.post(
            "/api/v1/campuses",
            {"name": "South", "code": "SOUTH", "is_primary": True},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        incumbent.refresh_from_db()
        self.assertFalse(incumbent.is_primary)

    def test_delete_soft_deletes(self) -> None:
        self.allow("school.campus.view", "school.campus.delete")
        with tenant_context(self.tenant.id):
            campus = CampusFactory(tenant=self.tenant)

        response = self.client.delete(f"/api/v1/campuses/{campus.pk}")

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        campus.refresh_from_db()
        self.assertIsNotNone(campus.deleted_at)

    def test_delete_is_blocked_while_dependents_exist(self) -> None:
        self.allow("school.campus.view", "school.campus.delete")
        with tenant_context(self.tenant.id):
            campus = CampusFactory(tenant=self.tenant)
            SectionFactory(
                tenant=self.tenant, campus=campus, school_class=ClassFactory(tenant=self.tenant)
            )

        response = self.client.delete(f"/api/v1/campuses/{campus.pk}")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        campus.refresh_from_db()
        self.assertIsNone(campus.deleted_at)


class SectionEndpointTests(SchoolOrganizationAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.grade = ClassFactory(tenant=self.tenant)

    def test_create_uses_the_documented_class_id_field(self) -> None:
        self.allow("school.section.view", "school.section.create")
        response = self.client.post(
            "/api/v1/sections",
            {
                "class_id": str(self.grade.pk),
                "campus_id": str(self.campus.pk),
                "name": "A",
                "capacity": 30,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        body = response.json()["data"]
        self.assertEqual(body["class_id"], str(self.grade.pk))

        with tenant_context(self.tenant.id):
            self.assertTrue(Section.objects.filter(school_class=self.grade).exists())

    def test_create_rejects_a_zero_capacity(self) -> None:
        self.allow("school.section.view", "school.section.create")
        response = self.client.post(
            "/api/v1/sections",
            {
                "class_id": str(self.grade.pk),
                "campus_id": str(self.campus.pk),
                "name": "A",
                "capacity": 0,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_rejects_an_inactive_class(self) -> None:
        self.allow("school.section.view", "school.section.create")
        with tenant_context(self.tenant.id):
            self.grade.is_active = False
            self.grade.save(update_fields=["is_active"])

        response = self.client.post(
            "/api/v1/sections",
            {"class_id": str(self.grade.pk), "campus_id": str(self.campus.pk), "name": "A"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_list_filters_by_campus(self) -> None:
        self.allow("school.section.view")
        with tenant_context(self.tenant.id):
            other_campus = CampusFactory(tenant=self.tenant)
            SectionFactory(tenant=self.tenant, campus=self.campus, school_class=self.grade)
            SectionFactory(tenant=self.tenant, campus=other_campus, school_class=self.grade)

        response = self.client.get(f"/api/v1/sections?campus_id={self.campus.pk}")

        self.assertEqual(len(response.json()["data"]), 1)


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


# `/class-subjects` moved to academics in this PR — the route is unchanged but
# the keys and the feature flag are not, so its endpoint tests moved with it to
# `apps/academics/tests/test_api.py::CurriculumEndpointTests`. What stays here is
# the *model* and `map_subject_to_class`, which school_organization still owns
# (see the ownership note in academics/views.py). Testing an endpoint from the
# module that no longer guards it means granting keys this module does not own.


class SchoolSettingsEndpointTests(SchoolOrganizationAPITestCase):
    def test_read_returns_the_tenant_configuration(self) -> None:
        self.allow("school.settings.view")
        response = self.client.get("/api/v1/school-settings")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["data"]["currency"], "USD")

    def test_update_requires_the_update_permission(self) -> None:
        self.allow("school.settings.view")
        response = self.client.patch("/api/v1/school-settings", {"locale": "ur"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_update_writes_configuration_and_branding(self) -> None:
        self.allow("school.settings.view", "school.settings.update")
        response = self.client.patch(
            "/api/v1/school-settings",
            {"locale": "ur", "currency": "pkr", "branding": {"primary_color": "#123456"}},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()["data"]
        self.assertEqual(body["currency"], "PKR")
        self.assertEqual(body["branding"], {"primary_color": "#123456"})

        self.tenant.refresh_from_db()
        self.assertEqual(self.tenant.locale, "ur")

    def test_update_rejects_a_non_iana_timezone(self) -> None:
        self.allow("school.settings.view", "school.settings.update")
        response = self.client.patch(
            "/api/v1/school-settings", {"timezone": "Middle/Earth"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class PermissionEnforcementTests(SchoolOrganizationAPITestCase):
    def test_an_endpoint_is_closed_without_any_permission(self) -> None:
        response = self.client.get("/api/v1/campuses")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_an_unauthenticated_request_is_rejected(self) -> None:
        self.client.credentials()
        self.client.logout()

        response = self.client.get("/api/v1/campuses")

        self.assertIn(
            response.status_code,
            (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN),
        )

    def test_a_view_key_does_not_grant_writes(self) -> None:
        self.allow("school.house.view")
        response = self.client.post("/api/v1/houses", {"name": "Falcon"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
