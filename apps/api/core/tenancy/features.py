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
from collections.abc import Callable
from dataclasses import dataclass

from django.core.cache import cache
from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)

_CACHE_TTL = 60
_CACHE_GENERATION_KEY = "feature:cache_generation"


def feature_cache_generation() -> int:
    return cache.get(_CACHE_GENERATION_KEY, 0)


def bump_feature_cache_generation() -> None:
    """Invalidate every cached feature-flag resolution at once.

    Not ``cache.clear()``: this is the *default* Django cache alias, shared
    with RBAC's permission-key cache (core/rbac/permissions.py) and, more
    importantly, DRF's rate-throttle counters (core/api/throttling.py uses the
    same default cache) — clearing it resets every tenant's and every user's
    throttle window platform-wide on every flag write, including a
    currently-throttled login-brute-force counter. Bumping a generation baked
    into the cache key (see is_feature_enabled) invalidates only this
    namespace, in O(1), with no key enumeration needed even though a bare
    FeatureFlag row carries no tenant_id to target a precise delete.
    """
    try:
        cache.incr(_CACHE_GENERATION_KEY)
    except ValueError:
        cache.set(_CACHE_GENERATION_KEY, 1)


def invalidate_feature_cache() -> None:
    """Bump the generation now, and again once the surrounding transaction commits.

    For a write whose effect on resolution lives in rows this transaction is changing (a
    plan's modules, a school's subscription). The first bump serves reads later in the same
    transaction. The second closes the window in which another request resolves a flag from
    the not-yet-committed old rows and caches that stale answer under the new generation.
    """
    bump_feature_cache_generation()
    transaction.on_commit(bump_feature_cache_generation)


# The plan step of resolution (step 3 below). Plans belong to the platform console's app, and
# `core` imports no app (ADR-0013), so that app registers a resolver from `ready()`. It answers
# a school's live plan's `enabled_modules`, or None when the school has no live subscription.
type PlanResolver = Callable[[uuid.UUID], frozenset[str] | None]

# At most one entry, keyed so a test can swap it with `mock.patch.dict`.
_plan_hooks: dict[str, PlanResolver] = {}
_PLAN_HOOK = "resolver"

# The keys a plan decides. Any other flag (`ai.*`, a kill switch for a feature) ignores plans.
_PLAN_KEY_PREFIX = "module."


def register_plan_resolver(fn: PlanResolver) -> None:
    """Register the plan resolver. A second, different one is a bug: two apps would disagree."""
    existing = _plan_hooks.get(_PLAN_HOOK)
    if existing is not None and existing is not fn:
        raise ValueError("A plan resolver is already registered.")
    _plan_hooks[_PLAN_HOOK] = fn


def _plan_enables(key: str, *, tenant_id: uuid.UUID) -> bool | None:
    """Whether the school's live plan enables ``key``; None when the plan has no say."""
    resolver = _plan_hooks.get(_PLAN_HOOK)
    if resolver is None or not key.startswith(_PLAN_KEY_PREFIX):
        return None
    modules = resolver(tenant_id)
    if modules is None:
        return None
    return key in modules


# Guards on switching a flag off for one school. A module that cannot run without another
# registers one from its `ready()` (ADR-0013): it answers why the school still needs the flag,
# or None. The console refuses a disable any guard objects to (409 `toggle_refused`).
type DisableGuard = Callable[[uuid.UUID], str | None]

# Keyed by flag, so a test can swap the registry with `mock.patch.dict`.
_disable_guards: dict[str, list[DisableGuard]] = {}


def register_disable_guard(key: str, fn: DisableGuard) -> None:
    """Ask ``fn`` before ``key`` is switched off for a school. Registering twice is a no-op."""
    guards = _disable_guards.setdefault(key, [])
    if fn not in guards:
        guards.append(fn)


def disable_refusal(key: str, tenant_id: uuid.UUID) -> str | None:
    """Why ``key`` may not be switched off for the school, or None when nothing objects."""
    for guard in _disable_guards.get(key, ()):
        reason = guard(tenant_id)
        if reason:
            return reason
    return None


def plan_change_refusal(tenant_id: uuid.UUID, modules: frozenset[str]) -> tuple[str, str] | None:
    """The first guarded ``module.*`` key a move to a plan of ``modules`` would switch off for
    the school, with the guard's reason; None when the move switches off nothing guarded.

    A key is switched off when it resolves on now and off once ``modules`` is the plan: a
    live override still decides, so one that keeps the module on makes the move harmless.
    """
    for key in sorted(_disable_guards):
        if not key.startswith(_PLAN_KEY_PREFIX) or key in modules:
            continue
        if not _resolve_feature(key, tenant_id=tenant_id):
            continue
        if _resolve_feature(key, tenant_id=tenant_id, plan_modules=modules):
            continue
        reason = disable_refusal(key, tenant_id)
        if reason:
            return key, reason
    return None


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


registry = FeatureRegistry()


def load_module_features() -> None:
    """Import every installed app's ``features`` module so it self-registers."""
    from django.apps import apps
    from django.utils.module_loading import module_has_submodule

    for config in apps.get_app_configs():
        if module_has_submodule(config.module, "features"):
            __import__(f"{config.name}.features")


def sync_feature_flags() -> dict[str, int]:
    """Upsert every registered flag key. Returns a small change summary.

    A new key takes the code's default and kill-switch setting. An existing row keeps its
    own: once a flag exists, the platform console owns ``default_enabled`` and
    ``is_kill_switch`` (`PATCH /platform/feature-flags/{id}`), and a deploy must not undo a
    kill switch an operator just threw. Only the description follows the code.

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
    drifted: list[str] = []

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
        else:
            if (current.default_enabled, current.is_kill_switch) != (
                spec.default_enabled,
                spec.is_kill_switch,
            ):
                drifted.append(spec.key)
            if current.description != spec.description:
                current.description = spec.description
                to_update.append(current)

    if to_create:
        FeatureFlag.objects.bulk_create(to_create, batch_size=500)
    if to_update:
        FeatureFlag.objects.bulk_update(to_update, ["description"], batch_size=500)
    if to_create:
        # bulk_create doesn't emit post_save, so signals.evict_on_flag_change never runs:
        # do its job here, or a new key stays resolved from a cached miss for _CACHE_TTL.
        bump_feature_cache_generation()

    if drifted:
        # WARNING: the code's new default does not apply here. A deliberate default change
        # needs a console edit or a data migration (platform-admin §7.6).
        logger.warning(
            "feature flags whose console setting differs from the code's default: %s",
            ", ".join(sorted(drifted)),
        )

    stale = sorted(set(existing) - registry.keys())
    if stale:
        logger.warning(
            "feature flag keys present in the database but no longer declared in code: %s",
            ", ".join(stale),
        )

    return {"created": len(to_create), "updated": len(to_update), "stale": len(stale)}


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
    3. The school's live plan, through the resolver the platform console registers
       (`register_plan_resolver`): a ``module.*`` key is enabled iff it is in the plan's
       ``enabled_modules``, so a module the plan lacks is off even if its default is on.
       A kill switch again stays at its default if the plan would turn it on. Keys outside
       ``module.*`` skip this step, and so does a school with no live subscription (the
       resolver answers None) or a deployment with no resolver.
    4. The flag's own default.

    A plan or subscription write calls `invalidate_feature_cache`, so a change reaches every
    school's next request rather than waiting out the cache TTL.
    """
    cache_key = f"feature:{feature_cache_generation()}:{tenant_id}:{key}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    resolved = _resolve_feature(key, tenant_id=tenant_id)
    cache.set(cache_key, resolved, _CACHE_TTL)
    return resolved


def resolve_without_override(key: str, *, tenant_id: uuid.UUID) -> bool:
    """What ``key`` resolves to for the school once its override is gone. Uncached.

    The console asks this before removing an override, to know whether removing it is a
    disable that a guard must allow (`disable_refusal`).
    """
    return _resolve_feature(key, tenant_id=tenant_id, ignore_override=True)


def _resolve_feature(
    key: str,
    *,
    tenant_id: uuid.UUID,
    ignore_override: bool = False,
    plan_modules: frozenset[str] | None = None,
) -> bool:
    """Resolve uncached. ``plan_modules`` stands in for the live plan's modules (a plan move)."""
    from core.tenancy.models import FeatureFlag, TenantFeatureOverride

    flag = FeatureFlag.objects.filter(key=key).first()
    if flag is None:
        logger.error("feature flag %r has no row — treating as disabled", key)
        return False

    override = (
        None
        if ignore_override
        else TenantFeatureOverride.all_tenants.filter(
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

    planned = (
        _plan_enables(key, tenant_id=tenant_id)
        if plan_modules is None
        else (key in plan_modules if key.startswith(_PLAN_KEY_PREFIX) else None)
    )
    if planned is not None:
        # The same rule as an override: a plan can switch a kill switch off, never on.
        if flag.is_kill_switch and planned:
            return flag.default_enabled
        return planned

    return flag.default_enabled
