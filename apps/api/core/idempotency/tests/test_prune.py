"""Retention for stored `Idempotency-Key` responses.

Closes the gap `core/idempotency/models.py` documented in a comment ("Supports a
future cleanup job pruning rows past the 24h window (no Celery beat exists yet)").
"""

from __future__ import annotations

import datetime

from django.test import TestCase
from django.utils import timezone

from apps.school_organization.tests.factories import TenantFactory
from core.idempotency.models import IdempotencyRecord
from core.idempotency.tasks import RETENTION, prune_idempotency_records, prune_tenant
from core.tenancy.context import tenant_context


def _record(tenant, *, key: str, age: datetime.timedelta) -> IdempotencyRecord:
    with tenant_context(tenant.id):
        record = IdempotencyRecord.objects.create(
            tenant=tenant,
            key=key,
            endpoint="students:enroll",
            response_status=200,
            response_body={"data": {"id": "x"}},
        )
        # created_at is auto_now_add, so age it explicitly with an UPDATE.
        IdempotencyRecord.objects.filter(pk=record.pk).update(created_at=timezone.now() - age)
    return record


class IdempotencyPruneTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()

    def test_prunes_records_past_the_retention_window(self) -> None:
        old = _record(self.tenant, key="old", age=RETENTION + datetime.timedelta(hours=1))

        with tenant_context(self.tenant.id):
            deleted = prune_tenant(self.tenant.pk)

        self.assertEqual(deleted, 1)
        with tenant_context(self.tenant.id):
            self.assertFalse(IdempotencyRecord.objects.filter(pk=old.pk).exists())

    def test_keeps_a_record_still_inside_the_replay_window(self) -> None:
        # RETENTION is deliberately wider than the 24h replay window, so a row a
        # client could still legitimately replay must survive.
        fresh = _record(self.tenant, key="fresh", age=datetime.timedelta(hours=2))

        with tenant_context(self.tenant.id):
            deleted = prune_tenant(self.tenant.pk)

        self.assertEqual(deleted, 0)
        with tenant_context(self.tenant.id):
            self.assertTrue(IdempotencyRecord.objects.filter(pk=fresh.pk).exists())

    def test_the_task_sweeps_every_tenant(self) -> None:
        other = TenantFactory()
        _record(self.tenant, key="a", age=RETENTION * 2)
        _record(other, key="b", age=RETENTION * 2)

        summary = prune_idempotency_records()

        self.assertEqual(summary["affected"], 2)
        self.assertEqual(summary["failed"], 0)

    def test_one_tenants_rows_are_never_visible_to_another(self) -> None:
        other = TenantFactory()
        mine = _record(self.tenant, key="mine", age=RETENTION * 2)

        with tenant_context(other.id):
            deleted = prune_tenant(other.pk)

        self.assertEqual(deleted, 0)
        with tenant_context(self.tenant.id):
            self.assertTrue(IdempotencyRecord.objects.filter(pk=mine.pk).exists())
