"""Shared tenant/role/admin-user provisioning for the dev and e2e seed commands.

Not a management command itself (Django only discovers modules directly under a
``management/commands/`` package), so it can be imported by both
``seed_dev_data`` and ``seed_e2e_data`` without either becoming runnable on its
own or being discoverable twice.
"""

from core.rbac.models import Permission, RecordScope, Role, RolePermission, User, UserRole
from core.tenancy.models import Tenant, TenantStatus


def ensure_tenant(slug: str, name: str) -> Tenant:
    tenant, created = Tenant.objects.get_or_create(
        slug=slug,
        defaults={"name": name, "status": TenantStatus.ACTIVE},
    )
    if not created and tenant.status != TenantStatus.ACTIVE:
        tenant.status = TenantStatus.ACTIVE
        tenant.save(update_fields=["status"])
    return tenant


def ensure_school_owner_role(*, slug: str = "school_owner", name: str = "School Owner") -> Role:
    """`school_owner` "can hold every permission" (users-and-roles.md §3) — granting

    the full current registry keeps this in sync as permissions are added, rather
    than hardcoding a subset that would silently go stale. ``RolePermission`` has a
    DB-level ``UniqueConstraint(role, permission)``, so ``ignore_conflicts=True``
    alone is already idempotent — no need to pre-filter already-granted rows first.
    """
    role, _ = Role.objects.get_or_create(
        tenant=None,
        slug=slug,
        defaults={"name": name, "is_default": True},
    )
    RolePermission.objects.bulk_create(
        [
            RolePermission(role=role, permission=permission)
            for permission in Permission.objects.all()
        ],
        batch_size=500,
        ignore_conflicts=True,
    )
    return role


def ensure_role_with_permissions(slug: str, name: str, permission_keys: list[str]) -> Role:
    """A tenant-agnostic role holding exactly `permission_keys`, not the full registry.

    Unlike `ensure_school_owner_role`, which grants *everything* on purpose, this is
    for seeding a role-based e2e journey where an all-powerful user can't prove a
    narrower scope/permission set actually gates anything. `Permission` rows already
    exist by the time this runs (seeded by `core.rbac.sync`'s `post_migrate` hook,
    same as `ensure_school_owner_role` relies on) — this only looks each one up by key.
    """
    role, _ = Role.objects.get_or_create(
        tenant=None,
        slug=slug,
        defaults={"name": name, "is_default": True},
    )
    permissions = Permission.objects.filter(key__in=permission_keys)
    RolePermission.objects.bulk_create(
        [RolePermission(role=role, permission=permission) for permission in permissions],
        batch_size=500,
        ignore_conflicts=True,
    )
    return role


def ensure_admin_user(
    tenant: Tenant,
    role: Role,
    *,
    email: str,
    password: str,
    first_name: str,
    last_name: str,
    scope: str = RecordScope.ALL,
) -> User:
    """Named for its original (and still most common) use — an all-scope admin — but
    `scope` is overridable for a role-based journey that needs a narrower one (e.g.
    `RecordScope.OWN` for a `student`-role seed user proving record-scope filtering).
    """
    user, created = User.objects.get_or_create(
        tenant=tenant,
        email=email,
        defaults={"first_name": first_name, "last_name": last_name, "is_active": True},
    )
    if created:
        user.set_password(password)
        user.save(update_fields=["password"])

    UserRole.objects.get_or_create(
        user=user,
        role=role,
        scope=scope,
        scope_ref=None,
        defaults={"tenant": tenant},
    )
    return user
