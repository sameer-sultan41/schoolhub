"""`assert_preference_may_be_saved` — the emergency-category floor."""

from __future__ import annotations

from django.test import TestCase

from apps.communication.preferences.services.save import assert_preference_may_be_saved
from core.api.exceptions import DomainRuleViolation
from core.notifications.models import NotificationCategory


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
