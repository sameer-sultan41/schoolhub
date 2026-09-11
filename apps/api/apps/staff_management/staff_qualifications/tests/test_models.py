"""Constraint-level tests for the StaffQualification model."""

from __future__ import annotations

import datetime

from django.db import IntegrityError, transaction
from django.test import TestCase

from apps.staff_management.tests.base import TenantFixtureMixin
from apps.staff_management.tests.factories import StaffFactory, StaffQualificationFactory
from core.tenancy.context import tenant_context


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
