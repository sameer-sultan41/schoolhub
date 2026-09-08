"""`NotificationPreference`, and `is_channel_enabled` — the preference resolver
`core.notifications` calls.
"""

from __future__ import annotations

import uuid

from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.test import TestCase

from apps.communication.models import NotificationPreference
from apps.communication.services import assert_preference_may_be_saved, is_channel_enabled
from apps.communication.tests.factories import NotificationPreferenceFactory, TenantFactory
from core.api.exceptions import DomainRuleViolation
from core.notifications.models import NotificationCategory, NotificationChannel
from core.tenancy.context import tenant_context


class EmergencyFloorTests(TestCase):
    def test_disabling_the_emergency_category_is_refused(self) -> None:
        with self.assertRaises(DomainRuleViolation):
            assert_preference_may_be_saved(
                event_category=NotificationCategory.EMERGENCY, is_enabled=False
            )

    def test_enabling_the_emergency_category_is_fine(self) -> None:
        assert_preference_may_be_saved(
            event_category=NotificationCategory.EMERGENCY, is_enabled=True
        )

    def test_disabling_a_non_emergency_category_is_fine(self) -> None:
        assert_preference_may_be_saved(event_category=NotificationCategory.FEES, is_enabled=False)


class IsChannelEnabledTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user_id = uuid.uuid4()

    def tearDown(self) -> None:
        cache.delete(f"notif-pref:{self.tenant.pk}:{self.user_id}")
        super().tearDown()

    def test_is_channel_enabled_defaults_to_true_with_no_preference_row(self) -> None:
        with tenant_context(self.tenant.id):
            enabled = is_channel_enabled(
                self.user_id, NotificationCategory.FEES, NotificationChannel.SMS, self.tenant.pk
            )

        self.assertTrue(enabled)

    def test_is_channel_enabled_reflects_a_stored_row(self) -> None:
        with tenant_context(self.tenant.id):
            NotificationPreferenceFactory(
                tenant=self.tenant,
                user_id=self.user_id,
                event_category=NotificationCategory.FEES,
                channel=NotificationChannel.SMS,
                is_enabled=False,
            )

            enabled = is_channel_enabled(
                self.user_id, NotificationCategory.FEES, NotificationChannel.SMS, self.tenant.pk
            )

        self.assertFalse(enabled)

    def test_is_channel_enabled_is_a_single_query_regardless_of_how_many_channels_are_checked(
        self,
    ) -> None:
        with tenant_context(self.tenant.id):
            for channel in NotificationChannel.values:
                NotificationPreferenceFactory(
                    tenant=self.tenant,
                    user_id=self.user_id,
                    event_category=NotificationCategory.FEES,
                    channel=channel,
                    is_enabled=True,
                )

            with self.assertNumQueries(1):
                for channel in NotificationChannel.values:
                    is_channel_enabled(
                        self.user_id, NotificationCategory.FEES, channel, self.tenant.pk
                    )

    def test_a_second_call_after_a_preference_change_sees_the_new_value(self) -> None:
        """Proves the signal-driven cache eviction, not just is_channel_enabled's shape."""
        with tenant_context(self.tenant.id):
            # Warm the cache at the default (no row yet).
            self.assertTrue(
                is_channel_enabled(
                    self.user_id,
                    NotificationCategory.FEES,
                    NotificationChannel.EMAIL,
                    self.tenant.pk,
                )
            )

            NotificationPreferenceFactory(
                tenant=self.tenant,
                user_id=self.user_id,
                event_category=NotificationCategory.FEES,
                channel=NotificationChannel.EMAIL,
                is_enabled=False,
            )

            self.assertFalse(
                is_channel_enabled(
                    self.user_id,
                    NotificationCategory.FEES,
                    NotificationChannel.EMAIL,
                    self.tenant.pk,
                )
            )


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
