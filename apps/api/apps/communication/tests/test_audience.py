"""`services.resolve_audience` — one query per resolution branch."""

from __future__ import annotations

import uuid

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from apps.communication import services
from apps.communication.models import AudienceType
from apps.communication.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    GuardianFactory,
    HouseFactory,
    SectionFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    StudentGuardianFactory,
    TenantFactory,
    UserFactory,
    grant,
)
from core.api.exceptions import DomainRuleViolation
from core.tenancy.context import tenant_context


class AudienceResolutionTestCase(TestCase):
    """A school with one enrolled student, their guardian, a house, two campuses."""

    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.other_campus = CampusFactory(tenant=self.tenant)
            self.session = AcademicSessionFactory(tenant=self.tenant)
            self.school_class = ClassFactory(tenant=self.tenant)
            self.section = SectionFactory(
                tenant=self.tenant, campus=self.campus, school_class=self.school_class
            )
            self.other_class = ClassFactory(tenant=self.tenant)
            self.house = HouseFactory(tenant=self.tenant)

            self.student_user = UserFactory(tenant=self.tenant)
            self.student = StudentFactory(
                tenant=self.tenant,
                campus=self.campus,
                house=self.house,
                user_id=self.student_user.pk,
            )
            self.guardian_user = UserFactory(tenant=self.tenant)
            self.guardian = GuardianFactory(tenant=self.tenant, user_id=self.guardian_user.pk)
            StudentGuardianFactory(
                tenant=self.tenant,
                student=self.student,
                guardian=self.guardian,
                has_portal_access=True,
            )
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=self.student,
                academic_session=self.session,
                school_class=self.school_class,
                section=self.section,
            )


class AllStaffTests(AudienceResolutionTestCase):
    def test_all_resolves_every_active_user(self) -> None:
        with tenant_context(self.tenant.id):
            recipients = services.resolve_audience(
                audience_type=AudienceType.ALL, audience_filter=None, tenant_id=self.tenant.pk
            )

        self.assertIn(self.student_user.pk, recipients)
        self.assertIn(self.guardian_user.pk, recipients)

    def test_staff_excludes_restricted_principal_roles(self) -> None:
        with tenant_context(self.tenant.id):
            staff_user = UserFactory(tenant=self.tenant)
            grant(staff_user, "communication.announcement.view")
            grant(
                self.guardian_user,
                "communication.notice.acknowledge",
                is_restricted_principal=True,
            )

            recipients = services.resolve_audience(
                audience_type=AudienceType.STAFF, audience_filter=None, tenant_id=self.tenant.pk
            )

        self.assertIn(staff_user.pk, recipients)
        self.assertNotIn(self.guardian_user.pk, recipients)

    def test_staff_narrowed_by_role_slugs(self) -> None:
        with tenant_context(self.tenant.id):
            matching_user = UserFactory(tenant=self.tenant)
            other_user = UserFactory(tenant=self.tenant)
            matching_role = grant(matching_user, "communication.announcement.view")
            grant(other_user, "communication.announcement.view")

            recipients = services.resolve_audience(
                audience_type=AudienceType.STAFF,
                audience_filter={"role_slugs": [matching_role.slug]},
                tenant_id=self.tenant.pk,
            )

        self.assertIn(matching_user.pk, recipients)
        self.assertNotIn(other_user.pk, recipients)

    def test_all_is_a_single_query(self) -> None:
        with tenant_context(self.tenant.id), CaptureQueriesContext(connection) as captured:
            services.resolve_audience(
                audience_type=AudienceType.ALL, audience_filter=None, tenant_id=self.tenant.pk
            )

        self.assertEqual(len(captured.captured_queries), 1)


class StudentsAndGuardiansTests(AudienceResolutionTestCase):
    def test_students_resolves_the_students_own_portal_account(self) -> None:
        with tenant_context(self.tenant.id):
            recipients = services.resolve_audience(
                audience_type=AudienceType.STUDENTS, audience_filter=None, tenant_id=self.tenant.pk
            )

        self.assertEqual(recipients, [self.student_user.pk])

    def test_guardians_resolves_the_guardian_not_the_student(self) -> None:
        with tenant_context(self.tenant.id):
            recipients = services.resolve_audience(
                audience_type=AudienceType.GUARDIANS,
                audience_filter=None,
                tenant_id=self.tenant.pk,
            )

        self.assertEqual(recipients, [self.guardian_user.pk])
        self.assertNotIn(self.student_user.pk, recipients)

    def test_a_guardian_with_portal_access_revoked_is_excluded(self) -> None:
        with tenant_context(self.tenant.id):
            other_student = StudentFactory(tenant=self.tenant, campus=self.campus)
            other_guardian = GuardianFactory(tenant=self.tenant, user_id=uuid.uuid4())
            StudentGuardianFactory(
                tenant=self.tenant,
                student=other_student,
                guardian=other_guardian,
                has_portal_access=False,
            )

            recipients = services.resolve_audience(
                audience_type=AudienceType.GUARDIANS,
                audience_filter=None,
                tenant_id=self.tenant.pk,
            )

        self.assertNotIn(other_guardian.user_id, recipients)

    def test_class_audience_type_resolves_to_guardians_of_that_class(self) -> None:
        with tenant_context(self.tenant.id):
            recipients = services.resolve_audience(
                audience_type=AudienceType.CLASS,
                audience_filter={"class_ids": [str(self.school_class.pk)]},
                tenant_id=self.tenant.pk,
            )

        self.assertEqual(recipients, [self.guardian_user.pk])

    def test_class_audience_type_excludes_guardians_of_a_different_class(self) -> None:
        with tenant_context(self.tenant.id):
            recipients = services.resolve_audience(
                audience_type=AudienceType.CLASS,
                audience_filter={"class_ids": [str(self.other_class.pk)]},
                tenant_id=self.tenant.pk,
            )

        self.assertEqual(recipients, [])

    def test_house_narrows_guardians(self) -> None:
        with tenant_context(self.tenant.id):
            other_house = HouseFactory(tenant=self.tenant)

            recipients = services.resolve_audience(
                audience_type=AudienceType.GUARDIANS,
                audience_filter={"house_ids": [str(other_house.pk)]},
                tenant_id=self.tenant.pk,
            )

        self.assertEqual(recipients, [])

    def test_campus_narrows_guardians(self) -> None:
        with tenant_context(self.tenant.id):
            recipients = services.resolve_audience(
                audience_type=AudienceType.GUARDIANS,
                audience_filter={"campus_ids": [str(self.other_campus.pk)]},
                tenant_id=self.tenant.pk,
            )

        self.assertEqual(recipients, [])

    def test_guardians_is_a_single_query(self) -> None:
        with tenant_context(self.tenant.id), CaptureQueriesContext(connection) as captured:
            services.resolve_audience(
                audience_type=AudienceType.GUARDIANS,
                audience_filter=None,
                tenant_id=self.tenant.pk,
            )

        self.assertEqual(len(captured.captured_queries), 1)


class CustomAudienceTests(AudienceResolutionTestCase):
    def test_custom_resolves_the_named_user_ids(self) -> None:
        with tenant_context(self.tenant.id):
            recipients = services.resolve_audience(
                audience_type=AudienceType.CUSTOM,
                audience_filter={"user_ids": [str(self.guardian_user.pk)]},
                tenant_id=self.tenant.pk,
            )

        self.assertEqual(recipients, [self.guardian_user.pk])

    def test_a_cross_tenant_user_id_is_refused(self) -> None:
        other_tenant = TenantFactory()
        with tenant_context(other_tenant.id):
            foreign_user = UserFactory(tenant=other_tenant)

        with tenant_context(self.tenant.id), self.assertRaises(DomainRuleViolation):
            services.resolve_audience(
                audience_type=AudienceType.CUSTOM,
                audience_filter={"user_ids": [str(foreign_user.pk)]},
                tenant_id=self.tenant.pk,
            )

    def test_empty_user_ids_resolves_to_nothing(self) -> None:
        with tenant_context(self.tenant.id):
            recipients = services.resolve_audience(
                audience_type=AudienceType.CUSTOM,
                audience_filter={"user_ids": []},
                tenant_id=self.tenant.pk,
            )

        self.assertEqual(recipients, [])


class AssertAudienceNonEmptyTests(TestCase):
    def test_an_empty_list_is_refused(self) -> None:
        with self.assertRaises(DomainRuleViolation):
            services.assert_audience_is_nonempty([])

    def test_a_nonempty_list_is_fine(self) -> None:
        services.assert_audience_is_nonempty([uuid.uuid4()])
