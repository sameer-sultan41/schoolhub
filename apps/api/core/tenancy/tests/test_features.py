"""Tests for feature-flag resolution and cache invalidation (core/tenancy/features.py).

`BumpFeatureCacheGenerationTests` is regression coverage for replacing a blunt
``cache.clear()`` — which wiped DRF's rate-throttle counters and RBAC's permission
cache off the same shared default Redis cache — with a generation counter scoped to
the ``feature:`` namespace.

`PlanResolutionTests` pins the plan step of the resolution order: an override, then the
live plan (``module.*`` keys only), then the flag's default, with a kill switch off
whatever the override or the plan say. `core` imports no app (ADR-0013), so these stand
a resolver in for the one the platform console registers.
"""

from __future__ import annotations

import uuid
from unittest import mock

from django.core.cache import cache
from django.test import TestCase

from core.tenancy import features
from core.tenancy.context import tenant_context
from core.tenancy.models import FeatureFlag, Tenant, TenantFeatureOverride

PROBE = "module.plan-probe"
DEFAULT_ON = "module.plan-default-on"
KILL = "module.plan-kill"
NON_MODULE = "ai.plan-probe"


class BumpFeatureCacheGenerationTests(TestCase):
    def tearDown(self) -> None:
        cache.clear()

    def test_bumping_the_generation_leaves_unrelated_cache_keys_untouched(self) -> None:
        cache.set("some:other:key", "still-here", 300)

        features.bump_feature_cache_generation()

        self.assertEqual(cache.get("some:other:key"), "still-here")

    def test_bumping_the_generation_increments_it(self) -> None:
        before = features.feature_cache_generation()
        features.bump_feature_cache_generation()
        self.assertEqual(features.feature_cache_generation(), before + 1)

    def test_a_resolution_cached_before_a_bump_is_unreachable_after(self) -> None:
        tenant_id = uuid.uuid4()
        key = "module.students"
        stale_cache_key = f"feature:{features.feature_cache_generation()}:{tenant_id}:{key}"
        cache.set(stale_cache_key, True, 300)

        features.bump_feature_cache_generation()

        fresh_cache_key = f"feature:{features.feature_cache_generation()}:{tenant_id}:{key}"
        self.assertNotEqual(stale_cache_key, fresh_cache_key)
        self.assertIsNone(cache.get(fresh_cache_key))

    def test_invalidate_bumps_now_and_again_on_commit(self) -> None:
        before = features.feature_cache_generation()

        with self.captureOnCommitCallbacks(execute=True):
            features.invalidate_feature_cache()
            self.assertEqual(features.feature_cache_generation(), before + 1)

        self.assertEqual(features.feature_cache_generation(), before + 2)


def resolving_plan(modules: frozenset[str] | None):
    """Stand in for the registered plan resolver: every tenant's live plan is ``modules``."""
    return mock.patch.dict(features._plan_hooks, {"resolver": lambda _tenant_id: modules})


class PlanResolutionTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        cache.clear()
        self.tenant = Tenant.objects.create(name="Plan School", slug="plan-school")
        self.flags = {
            key: FeatureFlag.objects.create(key=key, default_enabled=default, is_kill_switch=kill)
            for key, default, kill in (
                (PROBE, False, False),
                (DEFAULT_ON, True, False),
                (KILL, False, True),
                (NON_MODULE, False, False),
            )
        }

    def tearDown(self) -> None:
        cache.clear()
        super().tearDown()

    def enabled(self, key: str) -> bool:
        cache.clear()
        return features.is_feature_enabled(key, tenant_id=self.tenant.pk)

    def override(self, key: str, *, enabled: bool) -> None:
        with tenant_context(self.tenant.pk):
            TenantFeatureOverride.objects.create(
                tenant=self.tenant, feature_flag=self.flags[key], enabled=enabled, reason="test"
            )

    def test_plan_enables_module_without_override(self) -> None:
        with resolving_plan(frozenset({PROBE})):
            self.assertTrue(self.enabled(PROBE))

    def test_a_module_the_plan_lacks_is_disabled(self) -> None:
        # Even one whose own default is on: the plan decides `module.*` keys (A4).
        with resolving_plan(frozenset()):
            self.assertFalse(self.enabled(DEFAULT_ON))

    def test_no_live_subscription_falls_through_to_the_default(self) -> None:
        with resolving_plan(None):
            self.assertFalse(self.enabled(PROBE))
            self.assertTrue(self.enabled(DEFAULT_ON))

    def test_no_resolver_falls_through_to_the_default(self) -> None:
        with mock.patch.dict(features._plan_hooks, {}, clear=True):
            self.assertTrue(self.enabled(DEFAULT_ON))
            self.assertFalse(self.enabled(PROBE))

    def test_a_key_outside_module_ignores_the_plan(self) -> None:
        with resolving_plan(frozenset({NON_MODULE})):
            self.assertFalse(self.enabled(NON_MODULE))

    def test_override_beats_plan(self) -> None:
        self.override(PROBE, enabled=False)
        self.override(DEFAULT_ON, enabled=True)

        with resolving_plan(frozenset({PROBE})):
            self.assertFalse(self.enabled(PROBE))
        with resolving_plan(frozenset()):
            self.assertTrue(self.enabled(DEFAULT_ON))

    def test_kill_switch_beats_plan(self) -> None:
        with resolving_plan(frozenset({KILL})):
            self.assertFalse(self.enabled(KILL))

    def test_register_plan_resolver_refuses_a_second_resolver(self) -> None:
        def first(_tenant_id):
            return None

        def second(_tenant_id):
            return None

        with mock.patch.dict(features._plan_hooks, {}, clear=True):
            features.register_plan_resolver(first)
            features.register_plan_resolver(first)
            with self.assertRaises(ValueError):
                features.register_plan_resolver(second)
