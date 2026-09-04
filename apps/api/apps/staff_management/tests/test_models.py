"""Constraint-level tests for the staff-management models."""

from __future__ import annotations

import datetime

from django.db import IntegrityError, transaction
from django.test import TestCase

from apps.school_organization.tests.factories import CampusFactory, TenantFactory, UserFactory
from apps.staff_management.models import Staff
from apps.staff_management.tests.factories import (
    DEFAULT_JOINING_DATE,
    FileFactory,
    StaffDocumentFactory,
    StaffFactory,
    StaffQualificationFactory,
)
from core.tenancy.context import tenant_context


class TenantFixtureMixin:
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)


class StaffConstraintTests(TenantFixtureMixin, TestCase):
    def test_duplicate_employee_number_per_tenant_is_rejected(self) -> None:
        with tenant_context(self.tenant.id):
            StaffFactory(tenant=self.tenant, campus=self.campus, employee_number="DUP-001")
            with self.assertRaises(IntegrityError), transaction.atomic():
                StaffFactory(tenant=self.tenant, campus=self.campus, employee_number="DUP-001")

    def test_a_soft_deleted_employee_number_can_be_reused(self) -> None:
        with tenant_context(self.tenant.id):
            first = StaffFactory(
                tenant=self.tenant, campus=self.campus, employee_number="REUSE-001"
            )
            first.deleted_at = datetime.datetime.now(datetime.UTC)
            first.save(update_fields=["deleted_at"])

            second = StaffFactory(
                tenant=self.tenant, campus=self.campus, employee_number="REUSE-001"
            )
            self.assertEqual(second.employee_number, "REUSE-001")

    def test_duplicate_national_id_per_tenant_is_rejected(self) -> None:
        with tenant_context(self.tenant.id):
            StaffFactory(tenant=self.tenant, campus=self.campus, national_id="NID-001")
            with self.assertRaises(IntegrityError), transaction.atomic():
                StaffFactory(tenant=self.tenant, campus=self.campus, national_id="NID-001")

    def test_two_staff_with_no_national_id_coexist(self) -> None:
        with tenant_context(self.tenant.id):
            StaffFactory(tenant=self.tenant, campus=self.campus, national_id=None)
            StaffFactory(tenant=self.tenant, campus=self.campus, national_id=None)
            # No IntegrityError: the partial unique on national_id excludes NULLs.

    def test_duplicate_user_id_per_tenant_is_rejected(self) -> None:
        with tenant_context(self.tenant.id):
            user = UserFactory(tenant=self.tenant)
            StaffFactory(tenant=self.tenant, campus=self.campus, user_id=user.pk)
            with self.assertRaises(IntegrityError), transaction.atomic():
                StaffFactory(tenant=self.tenant, campus=self.campus, user_id=user.pk)

    def test_two_staff_with_no_portal_account_coexist(self) -> None:
        with tenant_context(self.tenant.id):
            StaffFactory(tenant=self.tenant, campus=self.campus, user_id=None)
            StaffFactory(tenant=self.tenant, campus=self.campus, user_id=None)
            # No IntegrityError: the partial unique on user_id excludes NULLs.

    def test_exit_date_before_joining_date_is_rejected(self) -> None:
        with (
            tenant_context(self.tenant.id),
            self.assertRaises(IntegrityError),
            transaction.atomic(),
        ):
            StaffFactory(
                tenant=self.tenant,
                campus=self.campus,
                joining_date=DEFAULT_JOINING_DATE,
                exit_date=DEFAULT_JOINING_DATE - datetime.timedelta(days=1),
            )

    def test_exit_date_on_or_after_joining_date_is_accepted(self) -> None:
        """Positive control: the constraint above rejects the direction, not the column."""
        with tenant_context(self.tenant.id):
            staff = StaffFactory(
                tenant=self.tenant,
                campus=self.campus,
                joining_date=DEFAULT_JOINING_DATE,
                exit_date=DEFAULT_JOINING_DATE,
            )
        self.assertEqual(staff.exit_date, DEFAULT_JOINING_DATE)


class StaffQualificationConstraintTests(TenantFixtureMixin, TestCase):
    def test_a_decided_qualification_without_a_verifier_is_rejected(self) -> None:
        with tenant_context(self.tenant.id):
            staff = StaffFactory(tenant=self.tenant, campus=self.campus)
            with self.assertRaises(IntegrityError), transaction.atomic():
                StaffQualificationFactory(
                    tenant=self.tenant, staff=staff, verification_status="verified"
                )

    def test_a_pending_qualification_with_a_verifier_already_set_is_rejected(self) -> None:
        with tenant_context(self.tenant.id):
            staff = StaffFactory(tenant=self.tenant, campus=self.campus)
            with self.assertRaises(IntegrityError), transaction.atomic():
                StaffQualificationFactory(
                    tenant=self.tenant,
                    staff=staff,
                    verification_status="pending",
                    verified_by="00000000-0000-0000-0000-000000000000",
                    verified_at=datetime.datetime.now(datetime.UTC),
                )

    def test_a_decided_qualification_with_a_verifier_is_accepted(self) -> None:
        """Positive control: the constraint pairs the columns, it does not forbid a decision."""
        with tenant_context(self.tenant.id):
            staff = StaffFactory(tenant=self.tenant, campus=self.campus)
            qualification = StaffQualificationFactory(
                tenant=self.tenant,
                staff=staff,
                verification_status="verified",
                verified_by="00000000-0000-0000-0000-000000000000",
                verified_at=datetime.datetime.now(datetime.UTC),
            )
        self.assertEqual(qualification.verification_status, "verified")


class StaffDocumentConstraintTests(TenantFixtureMixin, TestCase):
    def test_a_decided_document_without_a_verifier_is_rejected(self) -> None:
        with tenant_context(self.tenant.id):
            staff = StaffFactory(tenant=self.tenant, campus=self.campus)
            file = FileFactory(tenant=self.tenant)
            with self.assertRaises(IntegrityError), transaction.atomic():
                StaffDocumentFactory(
                    tenant=self.tenant, staff=staff, file=file, verification_status="verified"
                )

    def test_a_pending_document_with_a_verifier_already_set_is_rejected(self) -> None:
        with tenant_context(self.tenant.id):
            staff = StaffFactory(tenant=self.tenant, campus=self.campus)
            file = FileFactory(tenant=self.tenant)
            with self.assertRaises(IntegrityError), transaction.atomic():
                StaffDocumentFactory(
                    tenant=self.tenant,
                    staff=staff,
                    file=file,
                    verification_status="pending",
                    verified_by="00000000-0000-0000-0000-000000000000",
                    verified_at=datetime.datetime.now(datetime.UTC),
                )

    def test_a_decided_document_with_a_verifier_is_accepted(self) -> None:
        """Positive control: the constraint pairs the columns, it does not forbid a decision."""
        with tenant_context(self.tenant.id):
            staff = StaffFactory(tenant=self.tenant, campus=self.campus)
            file = FileFactory(tenant=self.tenant)
            document = StaffDocumentFactory(
                tenant=self.tenant,
                staff=staff,
                file=file,
                verification_status="rejected",
                verified_by="00000000-0000-0000-0000-000000000000",
                verified_at=datetime.datetime.now(datetime.UTC),
            )
        self.assertEqual(document.verification_status, "rejected")


class FilterAssignedToUserTests(TenantFixtureMixin, TestCase):
    def test_returns_the_direct_reports_of_the_given_user(self) -> None:
        with tenant_context(self.tenant.id):
            manager_user = UserFactory(tenant=self.tenant)
            manager = StaffFactory(tenant=self.tenant, campus=self.campus, user_id=manager_user.pk)
            report = StaffFactory(tenant=self.tenant, campus=self.campus, reports_to=manager)
            StaffFactory(tenant=self.tenant, campus=self.campus)  # unrelated, not a report

            result = Staff.filter_assigned_to_user(Staff.objects.alive(), user=manager_user)

            self.assertEqual(set(result.values_list("pk", flat=True)), {report.pk})

    def test_returns_none_for_no_user(self) -> None:
        """Documented fail-closed default — see the model docstring."""
        with tenant_context(self.tenant.id):
            manager_user = UserFactory(tenant=self.tenant)
            manager = StaffFactory(tenant=self.tenant, campus=self.campus, user_id=manager_user.pk)
            StaffFactory(tenant=self.tenant, campus=self.campus, reports_to=manager)

            result = Staff.filter_assigned_to_user(Staff.objects.alive(), user=None)

            self.assertFalse(result.exists())
