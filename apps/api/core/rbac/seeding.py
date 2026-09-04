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
    than hardcoding a subset that would silently go stale. Additive only, deliberately:
    revoking here would mean re-deriving "every permission" from `Permission.objects.all()`
    at call time is trusted to be *complete*, which it might not be if this ever ran
    before `core.rbac.sync`'s `post_migrate` hook finished populating that table — an
    incomplete read would then actively strip real grants rather than just fail to add
    new ones. ``RolePermission`` has a DB-level ``UniqueConstraint(role, permission)``,
    so ``ignore_conflicts=True`` alone is already idempotent — no need to pre-filter
    already-granted rows first.
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


def ensure_role_with_permissions(
    tenant: Tenant,
    slug: str,
    name: str,
    permission_keys: list[str],
    *,
    is_restricted_principal: bool = False,
) -> Role:
    """A role holding exactly `permission_keys`, not the full registry, scoped to
    `tenant` rather than the platform-wide `tenant=None` namespace.

    Unlike `ensure_school_owner_role`, which grants *everything* on purpose, this is
    for seeding a role-based e2e journey where an all-powerful user can't prove a
    narrower scope/permission set actually gates anything. `Permission` rows already
    exist by the time this runs (seeded by `core.rbac.sync`'s `post_migrate` hook,
    same as `ensure_school_owner_role` relies on) — this only looks each one up by key.

    `tenant`-scoped, not `tenant=None`, and deliberately so: `slug` values like
    "school_admin" are real, shipped role names — every module's permission registry
    (`RECORD_MANAGERS`, `CONFIG_MANAGERS`, `ACADEMIC_MANAGERS`, etc.) is keyed off that
    exact string. `Role.tenant=None` means "platform-seeded default, shared by every
    tenant with no custom role" (see the field's own help text) — a `tenant=None`
    "school_admin" row here would collide with that namespace, and this function's own
    revoke-on-re-seed behavior (below) would then strip real, production-relevant grants
    from whatever real default eventually lives there. Scoping to the e2e tenant makes
    that collision structurally impossible rather than merely unlikely today.

    `is_restricted_principal` must be set for a student/guardian-style fixture role:
    `DenyRestrictedPrincipals` (`core/rbac/permissions.py`) is keyed off that flag, not
    off the role's slug or permission set, so a seeded "student" role that omits it would
    silently pass every restricted-principal check regardless of what it's actually
    permitted to hold — a false-safe fixture that can't catch a real regression there.
    """
    role, created = Role.objects.get_or_create(
        tenant=tenant,
        slug=slug,
        defaults={
            "name": name,
            "is_default": True,
            "is_restricted_principal": is_restricted_principal,
        },
    )
    if not created and role.is_restricted_principal != is_restricted_principal:
        role.is_restricted_principal = is_restricted_principal
        role.save(update_fields=["is_restricted_principal"])

    permissions = list(Permission.objects.filter(key__in=permission_keys))
    found_keys = {permission.key for permission in permissions}
    missing_keys = set(permission_keys) - found_keys
    if missing_keys:
        raise ValueError(
            f"ensure_role_with_permissions({slug!r}): no Permission row for "
            f"{sorted(missing_keys)} — check for a renamed/removed permission key."
        )

    # Grant what's missing *and* revoke what's no longer requested — safe here because
    # this role is scoped to one e2e tenant, so a narrower re-seed (trimming a fixture
    # role down for a stricter CUJ) can only ever affect that tenant's own fixture.
    RolePermission.objects.bulk_create(
        [RolePermission(role=role, permission=permission) for permission in permissions],
        batch_size=500,
        ignore_conflicts=True,
    )
    RolePermission.objects.filter(role=role).exclude(permission__in=permissions).delete()
    return role


def ensure_seed_user(
    tenant: Tenant,
    role: Role,
    *,
    email: str,
    password: str,
    first_name: str,
    last_name: str,
    scope: str = RecordScope.ALL,
) -> User:
    """A seed user holding one `role`, at `scope` (default: unrestricted — the common
    case for an admin fixture; overridden for a narrower role-based journey, e.g.
    `RecordScope.OWN` for a `student`-role seed user proving record-scope filtering).

    Re-running with a *different* `scope` for the same (`user`, `role`) pair replaces
    the assignment rather than adding a second one: `UserRole`'s real uniqueness is
    `(user, role, scope, scope_ref)` (a user can legitimately hold one role at two
    different scopes at once — see the model's own constraint), so a naive
    `get_or_create` keyed on the *target* scope would leave a stale assignment at the
    *previous* scope sitting alongside it, silently widening this identity's effective
    access to the union of both instead of narrowing it to what `scope` now says.
    """
    user, created = User.objects.get_or_create(
        tenant=tenant,
        email=email,
        defaults={"first_name": first_name, "last_name": last_name, "is_active": True},
    )
    if created:
        user.set_password(password)
        user.save(update_fields=["password"])

    UserRole.objects.filter(user=user, role=role).exclude(scope=scope, scope_ref=None).delete()
    UserRole.objects.get_or_create(
        user=user,
        role=role,
        scope=scope,
        scope_ref=None,
        defaults={"tenant": tenant},
    )
    return user
