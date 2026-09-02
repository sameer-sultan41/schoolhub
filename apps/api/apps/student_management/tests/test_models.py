"""Constraint-level tests for the Student model."""

from __future__ import annotations

import datetime

from django.db import IntegrityError, transaction
from django.test import TestCase

from apps.school_organization.tests.factories import CampusFactory, TenantFactory
from apps.student_management.tests.factories import (
    DEFAULT_ADMISSION_DATE,
    DEFAULT_DOB,
    StudentFactory,
)
from core.tenancy.context import tenant_context


class TenantFixtureMixin:
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)


class StudentConstraintTests(TenantFixtureMixin, TestCase):
    def test_duplicate_admission_number_per_tenant_is_rejected(self) -> None:
        with tenant_context(self.tenant.id):
            StudentFactory(tenant=self.tenant, campus=self.campus, admission_number="DUP-001")
            with self.assertRaises(IntegrityError), transaction.atomic():
                StudentFactory(tenant=self.tenant, campus=self.campus, admission_number="DUP-001")

    def test_a_soft_deleted_admission_number_can_be_reused(self) -> None:
        with tenant_context(self.tenant.id):
            first = StudentFactory(
                tenant=self.tenant, campus=self.campus, admission_number="REUSE-001"
            )
            first.deleted_at = datetime.datetime.now(datetime.UTC)
            first.save(update_fields=["deleted_at"])

            second = StudentFactory(
                tenant=self.tenant, campus=self.campus, admission_number="REUSE-001"
            )
            self.assertEqual(second.admission_number, "REUSE-001")

    def test_two_students_with_no_portal_account_coexist(self) -> None:
        with tenant_context(self.tenant.id):
            StudentFactory(tenant=self.tenant, campus=self.campus, user_id=None)
            StudentFactory(tenant=self.tenant, campus=self.campus, user_id=None)
            # No IntegrityError: the partial unique on user_id excludes NULLs.

    def test_admission_date_before_date_of_birth_is_rejected(self) -> None:
        with (
            tenant_context(self.tenant.id),
            self.assertRaises(IntegrityError),
            transaction.atomic(),
        ):
            StudentFactory(
                tenant=self.tenant,
                campus=self.campus,
                date_of_birth=DEFAULT_ADMISSION_DATE,
                admission_date=DEFAULT_DOB,
            )

    def test_filter_assigned_to_user_returns_nothing(self) -> None:
        """Documented fail-closed default — see the model docstring."""
        from apps.student_management.models import Student

        with tenant_context(self.tenant.id):
            StudentFactory(tenant=self.tenant, campus=self.campus)
            result = Student.filter_assigned_to_user(Student.objects.alive(), user=None)
            self.assertFalse(result.exists())
