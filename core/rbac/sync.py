"""Synchronize the code-defined permission registry into the database.

Permission keys are code, not configuration: they ship with the release that uses
them. Rather than a data migration per module — which would drift the moment a
module adds a key — this runs on ``post_migrate``, the same hook Django itself uses
to create content types and default permissions.

Removal is deliberately not automatic. A key that disappears from the registry may
be a rename in progress or a module temporarily uninstalled, and silently deleting
its rows would revoke access from every role that held it. Stale rows are reported
instead.
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
                )
            )
        elif (
            current.module != spec.module
            or current.resource != spec.resource
            or current.action != spec.action
            or current.description != spec.description
        ):
            current.module = spec.module
            current.resource = spec.resource
            current.action = spec.action
            current.description = spec.description
            to_update.append(current)

    if to_create:
        Permission.objects.bulk_create(to_create, batch_size=500)
    if to_update:
        Permission.objects.bulk_update(
            to_update, ["module", "resource", "action", "description"], batch_size=500
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


def sync_permissions_on_migrate(sender, **kwargs) -> None:
    """``post_migrate`` receiver.

    Bound to the rbac app so it fires once per ``migrate``, after every app's
    tables exist and after ``AppConfig.ready`` has populated the registry.
    """
    sync_permissions()
