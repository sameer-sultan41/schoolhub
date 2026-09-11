"""Constraint-level tests for the StaffDocument model."""

from __future__ import annotations

import datetime

from django.db import IntegrityError, transaction
from django.test import TestCase

from apps.staff_management.tests.base import TenantFixtureMixin
from apps.staff_management.tests.factories import FileFactory, StaffDocumentFactory, StaffFactory
from core.tenancy.context import tenant_context


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
