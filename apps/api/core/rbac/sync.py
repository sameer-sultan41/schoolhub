"""Synchronize the code-defined permission registry, and every default role, into the database.

Permission keys are code, not configuration: they ship with the release that uses
them. Rather than a data migration per module — which would drift the moment a
module adds a key — this runs on ``post_migrate``, the same hook Django itself uses
to create content types and default permissions.

Removal is deliberately not automatic. A key that disappears from the registry may
be a rename in progress or a module temporarily uninstalled, and silently deleting
its rows would revoke access from every role that held it. Stale rows are reported
instead.

`sync_default_roles` is the production mechanism for default roles (ADR-0036): every slug in
`ALL_TENANT_ROLES` and `PLATFORM_ROLES` has one shared `tenant=None` row holding the keys the
registry gives it. Additive only, for the reason above.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def sync_permissions(*, verbose: bool = False) -> dict[str, int]:
    """Upsert every registered permission key. Returns a small change summary."""
    from core.rbac.models import Permission
    from core.rbac.registry import registry

    specs = registry.all()
    existing = {p.key: p for p in Permission.objects.all()}

    to_create = []
    to_update = []

    for spec in specs:
        current = existing.get(spec.key)
        if current is None:
            to_create.append(
                Permission(
                    key=spec.key,
                    module=spec.module,
                    resource=spec.resource,
                    action=spec.action,
                    description=spec.description,
                    scope=spec.scope,
                )
            )
        elif (
            current.module != spec.module
            or current.resource != spec.resource
            or current.action != spec.action
            or current.description != spec.description
            or current.scope != spec.scope
        ):
            current.module = spec.module
            current.resource = spec.resource
            current.action = spec.action
            current.description = spec.description
            current.scope = spec.scope
            to_update.append(current)

    if to_create:
        Permission.objects.bulk_create(to_create, batch_size=500)
    if to_update:
        Permission.objects.bulk_update(
            to_update, ["module", "resource", "action", "description", "scope"], batch_size=500
        )

    stale = sorted(set(existing) - registry.keys())
    if stale:
        logger.warning(
            "permission keys present in the database but no longer declared in code: %s",
            ", ".join(stale),
        )

    summary = {"created": len(to_create), "updated": len(to_update), "stale": len(stale)}
    if verbose:
        logger.info("permission sync: %s", summary)
    return summary


def sync_default_roles() -> dict[str, int]:
    """Create each default role (``tenant=None``) and grant it the registry's keys for it.

    One row per slug in ``ALL_TENANT_ROLES + PLATFORM_ROLES``, created with its flags
    (``is_platform`` for a platform role, ``is_restricted_principal`` for a portal role). It
    then gains ``registry.keys_for_role(slug)``, filtered to the role's own scope. The
    exception is ``school_owner``, which gains every tenant-scope key
    (users-and-roles.md §3), as `ensure_school_owner_role` grants it.

    Additive only: a key the registry stops naming stays granted, like a permission row
    `sync_permissions` stops seeing. Returns how many roles and grants were created.
    """
    from core.rbac.cache import evict_rbac_caches
    from core.rbac.models import Permission, Role, RolePermission, UserRole
    from core.rbac.registry import registry
    from core.rbac.roles import ALL_TENANT_ROLES, PLATFORM_ROLES, PORTAL_ROLES, SCHOOL_OWNER
    from core.rbac.seeding import role_permission_scope

    roles_created = grants_created = 0
    for slug in (*ALL_TENANT_ROLES, *PLATFORM_ROLES):
        role, created = Role.objects.get_or_create(
            tenant=None,
            slug=slug,
            deleted_at=None,
            defaults={
                "name": slug.replace("_", " ").title(),
                "is_default": True,
                "is_platform": slug in PLATFORM_ROLES,
                "is_restricted_principal": slug in PORTAL_ROLES,
            },
        )
        roles_created += created
        permissions = Permission.objects.filter(scope=role_permission_scope(role))
        if slug != SCHOOL_OWNER:
            permissions = permissions.filter(key__in=registry.keys_for_role(slug))
        missing = permissions.exclude(roles=role)
        new = RolePermission.objects.bulk_create(
            [RolePermission(role=role, permission=permission) for permission in missing],
            batch_size=500,
            ignore_conflicts=True,
        )
        if new:
            grants_created += len(new)
            # `bulk_create` sends no post_save, so core/rbac/signals.py never hears of these.
            evict_rbac_caches(UserRole.objects.filter(role=role).values_list("user_id", flat=True))
    return {"roles_created": roles_created, "grants_created": grants_created}


def sync_rbac_on_migrate(sender, **kwargs) -> None:
    """``post_migrate`` receiver: permission keys first, then the default roles holding them.

    Bound to the rbac app so it fires once per ``migrate``, after every app's
    tables exist and after ``AppConfig.ready`` has populated the registry. One receiver,
    so the roles are never synced against keys that are not there yet.
    """
    sync_permissions()
    sync_default_roles()
