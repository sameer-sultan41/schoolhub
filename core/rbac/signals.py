"""Cache invalidation for effective permissions.

Permission resolution is cached per user; any change to the role graph must evict
the affected users immediately or a revoked permission would keep working until the
TTL expired — a security bug, not just a staleness bug.
"""

from django.core.cache import cache
from django.db.models.signals import m2m_changed, post_delete, post_save
from django.dispatch import receiver

from core.rbac.models import Role, RolePermission, UserRole


def _evict(user_ids) -> None:
    keys = [f"perm-keys:{user_id}" for user_id in user_ids]
    if keys:
        cache.delete_many(keys)


@receiver([post_save, post_delete], sender=UserRole)
def evict_on_user_role_change(instance, **kwargs) -> None:
    _evict([instance.user_id])


@receiver([post_save, post_delete], sender=RolePermission)
def evict_on_role_permission_change(instance, **kwargs) -> None:
    _evict(UserRole.objects.filter(role_id=instance.role_id).values_list("user_id", flat=True))


@receiver(m2m_changed, sender=Role.permissions.through)
def evict_on_role_permissions_m2m(instance, **kwargs) -> None:
    _evict(UserRole.objects.filter(role_id=instance.pk).values_list("user_id", flat=True))


@receiver(post_delete, sender=Role)
def evict_on_role_delete(instance, **kwargs) -> None:
    _evict(UserRole.objects.filter(role_id=instance.pk).values_list("user_id", flat=True))
