"""`bulk_is_channel_enabled` — the preference resolver `core.notifications` calls."""

from __future__ import annotations

import uuid

from django.core.cache import cache
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from apps.communication.preferences.services.resolver import bulk_is_channel_enabled
from apps.communication.tests.factories import (
    NotificationPreferenceFactory,
    TenantFactory,
    enable_feature,
)
from core.notifications.models import NotificationCategory, NotificationChannel
from core.tenancy.context import tenant_context


class BulkIsChannelEnabledTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        enable_feature(self.tenant)
        self.user_id = uuid.uuid4()

    def tearDown(self) -> None:
        cache.delete(f"notif-pref:{self.tenant.pk}:{self.user_id}")
        super().tearDown()

    def test_defaults_to_true_with_no_preference_row(self) -> None:
        with tenant_context(self.tenant.id):
            result = bulk_is_channel_enabled(
                [self.user_id], NotificationCategory.FEES, NotificationChannel.SMS, self.tenant.pk
            )

        self.assertTrue(result.get(self.user_id, True))

    def test_reflects_a_stored_row(self) -> None:
        with tenant_context(self.tenant.id):
            NotificationPreferenceFactory(
                tenant=self.tenant,
                user_id=self.user_id,
                event_category=NotificationCategory.FEES,
                channel=NotificationChannel.SMS,
                is_enabled=False,
            )

            result = bulk_is_channel_enabled(
                [self.user_id], NotificationCategory.FEES, NotificationChannel.SMS, self.tenant.pk
            )

        self.assertFalse(result[self.user_id])

    def test_returns_nothing_without_querying_when_the_module_is_disabled(self) -> None:
        disabled_tenant = TenantFactory()  # never granted the feature
        with tenant_context(disabled_tenant.id):
            NotificationPreferenceFactory(
                tenant=disabled_tenant,
                user_id=self.user_id,
                event_category=NotificationCategory.FEES,
                channel=NotificationChannel.SMS,
                is_enabled=False,
            )

            with CaptureQueriesContext(connection) as captured:
                result = bulk_is_channel_enabled(
                    [self.user_id],
                    NotificationCategory.FEES,
                    NotificationChannel.SMS,
                    disabled_tenant.pk,
                )

        self.assertEqual(result, {})
        queries = [q["sql"] for q in captured.captured_queries]
        self.assertFalse(any("notification_preferences" in sql for sql in queries), queries)

    def test_is_a_single_query_regardless_of_how_many_users_are_checked(self) -> None:
        """The fan-out shape this batch resolver exists for — one query for the
        whole recipient list, not one per recipient."""
        user_ids = [uuid.uuid4() for _ in range(20)]
        with tenant_context(self.tenant.id):
            for user_id in user_ids:
                NotificationPreferenceFactory(
                    tenant=self.tenant,
                    user_id=user_id,
                    event_category=NotificationCategory.FEES,
                    channel=NotificationChannel.SMS,
                    is_enabled=True,
                )

            # Warm the feature-flag cache alone first (an empty recipient list
            # still runs that check) so the query below is only the preference
            # fetch this test is actually about.
            bulk_is_channel_enabled(
                [], NotificationCategory.FEES, NotificationChannel.SMS, self.tenant.pk
            )

            with self.assertNumQueries(1):
                result = bulk_is_channel_enabled(
                    user_ids, NotificationCategory.FEES, NotificationChannel.SMS, self.tenant.pk
                )

        self.assertEqual(len(result), 20)
        for user_id in user_ids:
            cache.delete(f"notif-pref:{self.tenant.pk}:{user_id}")

    def test_a_second_call_after_a_preference_change_sees_the_new_value(self) -> None:
        """Proves the signal-driven cache eviction, not just the resolver's shape."""
        with tenant_context(self.tenant.id):
            # Warm the cache at the default (no row yet).
            first = bulk_is_channel_enabled(
                [self.user_id], NotificationCategory.FEES, NotificationChannel.EMAIL, self.tenant.pk
            )
            self.assertTrue(first.get(self.user_id, True))

            NotificationPreferenceFactory(
                tenant=self.tenant,
                user_id=self.user_id,
                event_category=NotificationCategory.FEES,
                channel=NotificationChannel.EMAIL,
                is_enabled=False,
            )

            second = bulk_is_channel_enabled(
                [self.user_id], NotificationCategory.FEES, NotificationChannel.EMAIL, self.tenant.pk
            )
            self.assertFalse(second[self.user_id])
