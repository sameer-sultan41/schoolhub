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
