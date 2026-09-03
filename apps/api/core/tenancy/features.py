"""The feature-flag registry, and resolution of a flag's effective value.

Mirrors core/rbac/registry.py + sync.py deliberately: flags are code, not data,
each module declares its keys in its own ``features.py``, a ``post_migrate``
receiver upserts them into the database, and the check that matters
(``RequiresModuleFeature``) runs before any permission check
(docs/02-architecture/auth-and-rbac.md §2.3, check level 1).

See docs/02-architecture/multi-tenancy.md §5 ("every module checks its flag
server-side") and docs/01-phases/phase-2-core-build.md §4 rule 5 (every module
ships behind a flag, default off for real tenants).
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass

from django.core.cache import cache
from django.utils import timezone

logger = logging.getLogger(__name__)

_CACHE_TTL = 60


@dataclass(frozen=True)
class FeatureSpec:
    key: str
    description: str = ""
    default_enabled: bool = False
    is_kill_switch: bool = False


class FeatureRegistry:
    def __init__(self) -> None:
        self._specs: dict[str, FeatureSpec] = {}

    def register(
        self,
        key: str,
        description: str = "",
        *,
        default_enabled: bool = False,
        is_kill_switch: bool = False,
    ) -> FeatureSpec:
        if key in self._specs:
            raise ValueError(f"Duplicate feature flag key {key!r}")
        spec = FeatureSpec(
            key=key,
            description=description,
            default_enabled=default_enabled,
            is_kill_switch=is_kill_switch,
        )
        self._specs[key] = spec
        return spec

    def all(self) -> list[FeatureSpec]:
        return sorted(self._specs.values(), key=lambda s: s.key)

    def keys(self) -> set[str]:
        return set(self._specs)

    def __contains__(self, key: str) -> bool:
        return key in self._specs


registry = FeatureRegistry()


def load_module_features() -> None:
    """Import every installed app's ``features`` module so it self-registers."""
    from django.apps import apps
    from django.utils.module_loading import module_has_submodule

    for config in apps.get_app_configs():
        if module_has_submodule(config.module, "features"):
            __import__(f"{config.name}.features")


def sync_feature_flags(*, verbose: bool = False) -> dict[str, int]:
    """Upsert every registered flag key. Returns a small change summary.

    Removal is not automatic, for the same reason core.rbac.sync leaves stale
    permission rows alone: a key missing from the registry may be a rename in
    progress, and silently deleting the row would drop every tenant override
    pointing at it.
    """
    from core.tenancy.models import FeatureFlag

    specs = registry.all()
    existing = {f.key: f for f in FeatureFlag.objects.all()}

    to_create = []
    to_update = []

    for spec in specs:
        current = existing.get(spec.key)
        if current is None:
            to_create.append(
                FeatureFlag(
                    key=spec.key,
                    description=spec.description,
                    default_enabled=spec.default_enabled,
                    is_kill_switch=spec.is_kill_switch,
                )
            )
        elif (
            current.description != spec.description
            or current.default_enabled != spec.default_enabled
            or current.is_kill_switch != spec.is_kill_switch
        ):
            current.description = spec.description
            current.default_enabled = spec.default_enabled
            current.is_kill_switch = spec.is_kill_switch
            to_update.append(current)

    if to_create:
        FeatureFlag.objects.bulk_create(to_create, batch_size=500)
    if to_update:
        FeatureFlag.objects.bulk_update(
            to_update, ["description", "default_enabled", "is_kill_switch"], batch_size=500
        )
    if to_create or to_update:
        # bulk_create/bulk_update don't emit post_save, so signals.evict_on_flag_change
        # never runs — do its job here, or a flag's default flipped on deploy stays
        # resolved from the stale cached value for up to _CACHE_TTL.
        cache.clear()

    stale = sorted(set(existing) - registry.keys())
    if stale:
        logger.warning(
            "feature flag keys present in the database but no longer declared in code: %s",
            ", ".join(stale),
        )

    summary = {"created": len(to_create), "updated": len(to_update), "stale": len(stale)}
    if verbose:
        logger.info("feature flag sync: %s", summary)
    return summary


def sync_feature_flags_on_migrate(sender, **kwargs) -> None:
    """``post_migrate`` receiver, bound to the tenancy app in ``apps.py::ready()``."""
    sync_feature_flags()


def is_feature_enabled(key: str, *, tenant_id: uuid.UUID) -> bool:
    """Resolve whether ``key`` is enabled for ``tenant_id``.

    Order (docs/02-architecture/auth-and-rbac.md §2.3, multi-tenancy.md §5,
    entities/tenancy.md's feature_flags/tenant_feature_overrides):

    1. Flag row missing -> disabled, and logged: a required flag that was never
       registered is a deploy bug, not a "tenant doesn't have it" case.
    2. A live, non-expired tenant override -> its value, EXCEPT a kill-switch flag
       ignores an override that tries to turn it on — only the platform default can
       enable a kill switch; an override may still force it off.
    3. Plan-level enablement -> skipped here, deliberately: `plans`/`subscriptions`
       arrive with platform-admin (Tier 5). This is the documented insertion point.
    4. The flag's own default.
    """
    cache_key = f"feature:{tenant_id}:{key}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    resolved = _resolve_feature(key, tenant_id=tenant_id)
    cache.set(cache_key, resolved, _CACHE_TTL)
    return resolved


def _resolve_feature(key: str, *, tenant_id: uuid.UUID) -> bool:
    from core.tenancy.models import FeatureFlag, TenantFeatureOverride

    flag = FeatureFlag.objects.filter(key=key).first()
    if flag is None:
        logger.error("feature flag %r has no row — treating as disabled", key)
        return False

    override = (
        TenantFeatureOverride.all_tenants.filter(
            tenant_id=tenant_id, feature_flag=flag, deleted_at__isnull=True
        )
        .order_by("-created_at")
        .first()
    )
    if override is not None and (
        override.expires_at is None or override.expires_at > timezone.now()
    ):
        # A kill switch can still be force-disabled per tenant, just never force-enabled
        # (FeatureFlag.is_kill_switch's own help_text: "a tenant override can never turn
        # this ON — only the platform default can enable it. Overrides may still force
        # it off.").
        if flag.is_kill_switch and override.enabled:
            return flag.default_enabled
        return override.enabled

    return flag.default_enabled
