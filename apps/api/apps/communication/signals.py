"""Cache invalidation for the per-user channel-preference matrix.

Mirrors core/rbac/signals.py's evict-on-write shape: a preference change must
be visible to the next notify() fan-out immediately, not after the cache TTL —
a user who just disabled SMS and gets one anyway because of a five-minute-old
cache is the exact staleness class that module's docstring calls a bug, not
just staleness.
"""

from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from apps.communication.models import NotificationPreference
from apps.communication.services import evict_preference_cache


@receiver([post_save, post_delete], sender=NotificationPreference)
def evict_on_preference_change(instance, **kwargs) -> None:
    evict_preference_cache(user_id=instance.user_id, tenant_id=instance.tenant_id)
