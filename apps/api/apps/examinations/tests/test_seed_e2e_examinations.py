"""Tests for `seed_e2e_examinations` — the e2e tenant's complete default scale.

Real Postgres via `TestCase`, for the reason core/rbac/tests/test_seed_e2e_data.py
gives: the command writes through `tenant_context`, so RLS has to be live.
"""

from __future__ import annotations

from decimal import Decimal

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from apps.examinations.management.commands.seed_e2e_examinations import (
    E2E_BANDS,
    E2E_SCALE_NAME,
)
from apps.examinations.models import GradeBand, GradingScale
from apps.examinations.services import assert_scale_usable
from apps.examinations.tests.factories import GradeBandFactory, TenantFactory, complete_scale
from core.rbac.management.commands.seed_e2e_data import (
    E2E_OTHER_TENANT_SLUG,
    E2E_TENANT_SLUG,
)
from core.tenancy.context import tenant_context


class SeedE2EExaminationsTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        # The command refuses any tenant but the e2e ones, so the test tenant is one.
        self.tenant = TenantFactory(slug=E2E_TENANT_SLUG)

    def seed(self) -> None:
        call_command("seed_e2e_examinations", tenant=self.tenant.slug)

    def test_seeds_one_complete_default_scale_with_ordered_bands(self) -> None:
        self.seed()

        with tenant_context(self.tenant.id):
            scale = GradingScale.objects.alive().get(is_default=True)
            self.assertEqual(scale.name, E2E_SCALE_NAME)
            assert_scale_usable(scale)
            bands = GradeBand.objects.alive().filter(grading_scale=scale).order_by("sort_order")
            self.assertEqual([band.label for band in bands], [label for label, *_ in E2E_BANDS])

    def test_is_idempotent(self) -> None:
        self.seed()
        self.seed()

        with tenant_context(self.tenant.id):
            scales = GradingScale.objects.alive().filter(name=E2E_SCALE_NAME)
            self.assertEqual(scales.count(), 1)
            self.assertEqual(
                GradeBand.objects.alive().filter(grading_scale=scales.get()).count(),
                len(E2E_BANDS),
            )

    def test_takes_the_default_from_an_existing_scale(self) -> None:
        with tenant_context(self.tenant.id):
            previous = complete_scale(self.tenant, is_default=True)

        self.seed()

        with tenant_context(self.tenant.id):
            previous.refresh_from_db()
            self.assertFalse(previous.is_default)
            self.assertEqual(GradingScale.objects.alive().get(is_default=True).name, E2E_SCALE_NAME)

    def test_converges_a_drifted_scale_back_to_complete(self) -> None:
        """A band edited out of place is restored, and a stray one removed."""
        self.seed()
        with tenant_context(self.tenant.id):
            scale = GradingScale.objects.alive().get(name=E2E_SCALE_NAME)
            band = GradeBand.objects.alive().get(grading_scale=scale, label="F")
            band.max_percent = Decimal("40.00")
            band.save(update_fields=["max_percent", "updated_at"])
            GradeBandFactory(
                tenant=self.tenant,
                grading_scale=scale,
                label="X",
                min_percent=Decimal("10.00"),
                max_percent=Decimal("20.00"),
            )

        self.seed()

        with tenant_context(self.tenant.id):
            assert_scale_usable(scale)
            self.assertFalse(
                GradeBand.objects.alive().filter(grading_scale=scale, label="X").exists()
            )

    def test_an_unknown_tenant_is_refused(self) -> None:
        """An e2e slug with no tenant behind it: allowed by name, still refused."""
        with self.assertRaisesMessage(CommandError, "No tenant with slug"):
            call_command("seed_e2e_examinations", tenant=E2E_OTHER_TENANT_SLUG)

    def test_a_non_e2e_tenant_is_refused_and_left_untouched(self) -> None:
        real_school = TenantFactory(slug="real-school")

        with self.assertRaisesMessage(CommandError, "Refusing 'real-school'"):
            call_command("seed_e2e_examinations", tenant=real_school.slug)

        with tenant_context(real_school.id):
            self.assertFalse(GradingScale.objects.alive().exists())
