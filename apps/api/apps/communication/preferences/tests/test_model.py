"""`NotificationPreference` — model-level constraints and record-scope hook."""

from __future__ import annotations

import uuid

from django.db import IntegrityError, transaction
from django.test import TestCase

from apps.communication.models import NotificationPreference
from apps.communication.tests.factories import NotificationPreferenceFactory, TenantFactory
from core.notifications.models import NotificationCategory, NotificationChannel
from core.tenancy.context import tenant_context


class PreferenceModelTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()

    def test_two_preferences_cannot_share_a_tenant_user_category_channel(self) -> None:
        user_id = uuid.uuid4()
        with tenant_context(self.tenant.id):
            NotificationPreferenceFactory(
                tenant=self.tenant,
                user_id=user_id,
                event_category=NotificationCategory.FEES,
                channel=NotificationChannel.EMAIL,
            )
            with self.assertRaises(IntegrityError), transaction.atomic():
                NotificationPreferenceFactory(
                    tenant=self.tenant,
                    user_id=user_id,
                    event_category=NotificationCategory.FEES,
                    channel=NotificationChannel.EMAIL,
                )

    def test_filter_owned_by_user_returns_only_the_callers_own_rows(self) -> None:
        owner_id = uuid.uuid4()
        other_id = uuid.uuid4()
        with tenant_context(self.tenant.id):
            NotificationPreferenceFactory(tenant=self.tenant, user_id=owner_id)
            NotificationPreferenceFactory(tenant=self.tenant, user_id=other_id)

            class _FakeUser:
                pk = owner_id

            rows = NotificationPreference.filter_owned_by_user(
                NotificationPreference.objects.all(), _FakeUser()
            )

            self.assertEqual({row.user_id for row in rows}, {owner_id})
