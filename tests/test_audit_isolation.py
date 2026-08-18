"""The audit log must never be able to undo the write it is recording.

This guards a failure that was live in the codebase and invisible: audit payloads
carry whatever a serializer returns, which includes native ``uuid.UUID`` and
``Decimal`` objects, and writing one of those to a ``JSONField`` raised inside
``Model.save_base``. That call marks the surrounding transaction for rollback, so
catching the exception was not enough — the caller's mutation was discarded while
the caller still received a success response.

The two properties below are what make ``record_audit``'s contract true, so they
are asserted directly rather than only through an endpoint.
"""

import uuid
from decimal import Decimal

from django.db import transaction
from django.test import TestCase

from core.audit.models import AuditLog
from core.audit.services import record_audit
from core.tenancy.context import tenant_context
from core.tenancy.models import Tenant, TenantSettings


class _FakeRequest:
    """Minimal stand-in: record_audit only reads these attributes."""

    def __init__(self, tenant=None, user=None):
        self.tenant = tenant
        self.user = user
        self.request_id = str(uuid.uuid4())
        self.META = {"REMOTE_ADDR": "203.0.113.10", "HTTP_USER_AGENT": "test"}


class AuditPayloadTests(TestCase):
    def setUp(self) -> None:
        self.tenant = Tenant.objects.create(name="Test School", slug="test-school")
        self.request = _FakeRequest(tenant=self.tenant)

    def test_native_types_are_stored_rather_than_raising(self):
        """A payload shaped like real serializer output must persist."""
        with tenant_context(self.tenant.id):
            settings = TenantSettings.objects.create(tenant=self.tenant)
            entry = record_audit(
                self.request,
                "create",
                settings,
                after={
                    "id": uuid.uuid4(),
                    "amount": Decimal("1234.50"),
                    "nested": {"related_id": uuid.uuid4()},
                    "many": [uuid.uuid4()],
                },
            )

        self.assertIsNotNone(entry, "the audit row should have been written")
        self.assertEqual(AuditLog.objects.filter(pk=entry.pk).count(), 1)

    def test_an_audit_that_fails_in_python_does_not_discard_the_write(self):
        """A payload no encoder can handle is rejected before any database work."""
        with tenant_context(self.tenant.id), transaction.atomic():
            settings = TenantSettings.objects.create(tenant=self.tenant)
            record_audit(self.request, "create", settings, after={"bad": object()})

            self.assertTrue(TenantSettings.objects.filter(pk=settings.pk).exists())

    def test_an_audit_that_fails_in_the_database_does_not_discard_the_write(self):
        """The property that actually matters, exercised through a real database error.

        A NUL byte survives JSON encoding but PostgreSQL refuses to store it, so
        this reaches the INSERT and fails there — standing in for any future audit
        failure, such as an oversized field or a denied row. Without the savepoint
        around the insert, this rollback would take the caller's write with it and
        the caller would never know.
        """
        with tenant_context(self.tenant.id), transaction.atomic():
            settings = TenantSettings.objects.create(tenant=self.tenant)
            record_audit(self.request, "create", settings, after={"note": "bad\x00value"})

            self.assertTrue(
                TenantSettings.objects.filter(pk=settings.pk).exists(),
                "the audited write was rolled back by its own audit entry",
            )
