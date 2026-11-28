"""Tests for feature-flag cache-generation invalidation (core/tenancy/features.py).

Regression coverage for replacing a blunt ``cache.clear()`` — which wiped DRF's
rate-throttle counters and RBAC's permission cache off the same shared default
Redis cache — with a generation counter scoped to the ``feature:`` namespace.
"""

from __future__ import annotations

import uuid

from django.core.cache import cache
from django.test import TestCase

from core.tenancy import features


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


class EnabledFeatureKeysTests(TestCase):
    """`enabled_feature_keys` resolves every flag by `is_feature_enabled`'s rules, in bulk."""

    def setUp(self) -> None:
        from datetime import timedelta

        from django.utils import timezone

        from apps.school_organization.tests.factories import TenantFactory
        from core.tenancy.context import tenant_context
        from core.tenancy.models import FeatureFlag, TenantFeatureOverride

        cache.clear()
        self.tenant = TenantFactory()
        specs = {
            "module.zz-default-on": (True, False, None),
            "module.zz-forced-on": (False, False, True),
            "module.zz-forced-off": (True, False, False),
            "module.zz-kill-switch": (False, True, True),
            "module.zz-expired-on": (False, False, "expired"),
            "other.zz-default-on": (True, False, None),
        }
        self.keys = set(specs)
        self.specs = [features.FeatureSpec(key=key) for key in sorted(specs)]
        for key, (default, kill_switch, override) in specs.items():
            flag = FeatureFlag.objects.create(
                key=key, default_enabled=default, is_kill_switch=kill_switch
            )
            if override is None:
                continue
            with tenant_context(self.tenant.id):
                TenantFeatureOverride.objects.create(
                    tenant=self.tenant,
                    feature_flag=flag,
                    enabled=override is not False,
                    reason="test",
                    expires_at=(
                        timezone.now() - timedelta(days=1) if override == "expired" else None
                    ),
                )

    def _enabled(self, prefix: str) -> list[str]:
        from unittest import mock

        from core.tenancy.context import tenant_context

        with (
            mock.patch.object(features.registry, "all", return_value=self.specs),
            tenant_context(self.tenant.id),
        ):
            return features.enabled_feature_keys(tenant_id=self.tenant.id, prefix=prefix)

    def test_matches_the_single_key_resolver(self) -> None:
        self.assertEqual(self._enabled("module."), ["module.zz-default-on", "module.zz-forced-on"])
        from core.tenancy.context import tenant_context

        with tenant_context(self.tenant.id):
            expected = sorted(
                key
                for key in self.keys
                if key.startswith("module.")
                and features.is_feature_enabled(key, tenant_id=self.tenant.id)
            )
        self.assertEqual(self._enabled("module."), expected)

    def test_prefix_limits_the_keys(self) -> None:
        self.assertEqual(self._enabled("other."), ["other.zz-default-on"])

    def test_runs_in_two_queries(self) -> None:
        from unittest import mock

        from core.tenancy.context import tenant_context

        with (
            mock.patch.object(features.registry, "all", return_value=self.specs),
            tenant_context(self.tenant.id),
            self.assertNumQueries(2),
        ):
            features.enabled_feature_keys(tenant_id=self.tenant.id, prefix="module.")
