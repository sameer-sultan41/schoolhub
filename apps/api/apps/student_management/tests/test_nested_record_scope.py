"""Record scope on the *nested* student endpoints.

The guardian scope fix originally reached only the top-level `Student` queryset.
The nested viewsets re-ran `scope_queryset` against models that have no record
scope of their own — no `scope_own_field`, no `filter_owned_by_user` — so an
`own`-scoped caller fell straight through to `.none()`. A guardian could open
their child's record and find every tab under it silently empty: documents,
emergency contacts, guardian links, all blank rather than denied.

These assert the mixin's actual contract: the parent lookup is the
authorization, and everything under a student the caller may see is visible.
"""

from __future__ import annotations

from rest_framework import status
from rest_framework.test import APITestCase

from apps.school_organization.tests.factories import (
    CampusFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.student_management.tests.factories import (
    EmergencyContactFactory,
    GuardianFactory,
    StudentDocumentFactory,
    StudentFactory,
    StudentGuardianFactory,
    enable_feature,
)
from core.files.tests.factories import FileFactory
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

# Emergency contacts have no key of their own: §4 declares none, so the viewset
# reuses `students.student.view` (permissions.py's header records the decision).
VIEW_KEYS = (
    "students.student.view",
    "students.guardian.view",
    "students.document.view",
)


class GuardianNestedScopeTests(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        enable_feature(self.tenant, "module.students")
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.child = StudentFactory(tenant=self.tenant, campus=self.campus)
            self.other_child = StudentFactory(tenant=self.tenant, campus=self.campus)

        self.guardian_user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            guardian = GuardianFactory(tenant=self.tenant, user_id=self.guardian_user.pk)
            StudentGuardianFactory(tenant=self.tenant, student=self.child, guardian=guardian)
            EmergencyContactFactory(tenant=self.tenant, student=self.child)
            StudentDocumentFactory(
                tenant=self.tenant,
                student=self.child,
                file=FileFactory(tenant=self.tenant, purpose="student.document"),
            )

        authenticate(self.client, self.guardian_user)
        grant(
            self.guardian_user,
            *VIEW_KEYS,
            scope=RecordScope.OWN,
            is_restricted_principal=True,
        )

    def test_a_guardian_sees_their_child_emergency_contacts(self) -> None:
        response = self.client.get(f"/api/v1/students/{self.child.pk}/emergency-contacts")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(len(response.json()["data"]), 1)

    def test_a_guardian_sees_their_child_documents(self) -> None:
        response = self.client.get(f"/api/v1/students/{self.child.pk}/documents")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(len(response.json()["data"]), 1)

    def test_a_guardian_sees_their_child_guardian_links(self) -> None:
        response = self.client.get(f"/api/v1/students/{self.child.pk}/guardians")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(len(response.json()["data"]), 1)

    def test_the_nested_routes_404_for_a_child_they_are_not_linked_to(self) -> None:
        """The parent lookup is the authorization, so it is what refuses."""
        for nested in ("emergency-contacts", "documents", "guardians"):
            with self.subTest(nested=nested):
                response = self.client.get(f"/api/v1/students/{self.other_child.pk}/{nested}")
                self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_stranger_with_own_scope_sees_nothing_anywhere(self) -> None:
        stranger = UserFactory(tenant=self.tenant)
        authenticate(self.client, stranger)
        grant(stranger, *VIEW_KEYS, scope=RecordScope.OWN, is_restricted_principal=True)

        self.assertEqual(self.client.get("/api/v1/students").json()["data"], [])
        self.assertEqual(
            self.client.get(f"/api/v1/students/{self.child.pk}/documents").status_code,
            status.HTTP_404_NOT_FOUND,
        )
