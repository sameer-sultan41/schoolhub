"""Cache invalidation for effective permissions and record scopes.

Permission resolution is cached per user; any change to the role graph must evict
the affected users immediately or a revoked permission would keep working until the
TTL expired — a security bug, not just a staleness bug. Which keys to drop, and when,
is `core.rbac.cache.evict_rbac_caches`.

`bulk_create` and queryset `update()` send no signals, so code that writes the role
graph that way for a user who may already be cached calls `evict_rbac_caches` itself
(core/rbac/seeding.py does). Staff `:invite` bulk-creates the roles of a brand-new user,
who has no cache entry yet.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from typing import Any

from django.db.models import QuerySet
from django.db.models.signals import m2m_changed, post_delete, post_save
from django.dispatch import receiver

from core.rbac.cache import evict_rbac_caches
from core.rbac.models import Permission, Role, RolePermission, UserRole


def _holders(role_ids: Iterable[uuid.UUID]) -> QuerySet[UserRole, uuid.UUID]:
    return UserRole.objects.filter(role_id__in=list(role_ids)).values_list("user_id", flat=True)


@receiver([post_save, post_delete], sender=UserRole)
def evict_on_user_role_change(instance: UserRole, **kwargs: Any) -> None:
    evict_rbac_caches([instance.user_id])


@receiver([post_save, post_delete], sender=RolePermission)
def evict_on_role_permission_change(instance: RolePermission, **kwargs: Any) -> None:
    evict_rbac_caches(_holders([instance.role_id]))


@receiver(m2m_changed, sender=Role.permissions.through)
def evict_on_role_permissions_m2m(
    instance: Role | Permission,
    reverse: bool,
    pk_set: set[uuid.UUID] | None,
    **kwargs: Any,
) -> None:
    if not reverse:
        role_ids: Iterable[uuid.UUID] = [instance.pk]
    elif pk_set:
        role_ids = pk_set  # permission.roles.add/remove(...): pk_set holds the roles
    else:
        # permission.roles.clear(): at pre_clear the roles are still linked.
        role_ids = Role.objects.filter(permissions=instance).values_list("pk", flat=True)
    evict_rbac_caches(_holders(role_ids))


@receiver(post_save, sender=Role)
def evict_on_role_save(instance: Role, **kwargs: Any) -> None:
    # A soft delete is a save (`deleted_at` set): every holder loses the role's keys,
    # scopes and restricted-principal status at once.
    evict_rbac_caches(_holders([instance.pk]))


@receiver(post_delete, sender=Role)
def evict_on_role_delete(instance: Role, **kwargs: Any) -> None:
    evict_rbac_caches(_holders([instance.pk]))
