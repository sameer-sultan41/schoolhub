"""Model-level constraint tests for the StudentGuardian *link*.

Moved from student_management/tests/test_guardians_documents.py's
``StudentGuardianConstraintTests``. ``TenantFixtureMixin`` is copied from the
same source file rather than shared yet — a human will dedupe it into a
common base once every sibling package has finished its own extraction.
"""

from __future__ import annotations

from django.db import IntegrityError, transaction
from django.test import TestCase

from apps.school_organization.tests.factories import CampusFactory, TenantFactory
from apps.student_management.tests.factories import (
    GuardianFactory,
    StudentFactory,
    StudentGuardianFactory,
)
from core.tenancy.context import tenant_context


class TenantFixtureMixin:
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.student = StudentFactory(tenant=self.tenant, campus=self.campus)


class StudentGuardianConstraintTests(TenantFixtureMixin, TestCase):
    def test_a_second_link_between_the_same_student_and_guardian_is_rejected(self) -> None:
        with tenant_context(self.tenant.id):
            guardian = GuardianFactory(tenant=self.tenant)
            StudentGuardianFactory(tenant=self.tenant, student=self.student, guardian=guardian)
            with self.assertRaises(IntegrityError), transaction.atomic():
                StudentGuardianFactory(tenant=self.tenant, student=self.student, guardian=guardian)

    def test_a_second_primary_guardian_for_the_same_student_is_rejected(self) -> None:
        with tenant_context(self.tenant.id):
            first = GuardianFactory(tenant=self.tenant)
            second = GuardianFactory(tenant=self.tenant)
            StudentGuardianFactory(
                tenant=self.tenant, student=self.student, guardian=first, is_primary=True
            )
            with self.assertRaises(IntegrityError), transaction.atomic():
                StudentGuardianFactory(
                    tenant=self.tenant, student=self.student, guardian=second, is_primary=True
                )
