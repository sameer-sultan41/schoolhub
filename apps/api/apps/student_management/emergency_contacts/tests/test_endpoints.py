"""Tests for the EmergencyContact resource — nested-resource create.

Moved from student_management/tests/test_guardians_documents.py's
``EmergencyContactTests``.
"""

from __future__ import annotations

from rest_framework import status

from apps.student_management.tests.base import StudentManagementAPITestCase as _BaseAPITestCase
from apps.student_management.tests.factories import StudentFactory
from core.tenancy.context import tenant_context


class StudentManagementAPITestCase(_BaseAPITestCase):
    """Adds a student to the shared base — this resource is reachable only

    nested under one.
    """

    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.student = StudentFactory(tenant=self.tenant, campus=self.campus)


class EmergencyContactTests(StudentManagementAPITestCase):
    def test_add_an_emergency_contact(self) -> None:
        self.allow("students.student.update", "students.student.view")

        response = self.client.post(
            f"/api/v1/students/{self.student.pk}/emergency-contacts",
            {"name": "Aunt Ayesha", "relationship": "aunt", "phone": "+923001234567"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
