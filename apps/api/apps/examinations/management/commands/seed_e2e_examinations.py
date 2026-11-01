"""Seed the e2e tenant's grading scale — one complete default, `E2E Percentage`.

**Its own command rather than a step in `core`'s `seed_e2e_data`.** ADR-0013
forbids `core/` importing an app, and `tests/test_import_boundaries.py` refuses
any new `KNOWN_VIOLATIONS` entry. So this is the first seed command `core` runs
by name (`call_command`), which keeps the examinations models behind this
module's own boundary.

**E2E tenants only.** It rewrites the tenant's default grading scale, so any
`--tenant` other than the two e2e slugs is refused with a `CommandError`.

**Why a scale has to be seeded at all.** An exam refuses a scale whose bands do
not cover 0-100% (`services.assert_scale_usable`), and falls back to the tenant
default when it names none. A live spec creating an exam with no default and
no complete scale could only ever assert that refusal.

Idempotent: the scale is found by name, each band updated by label, and a live
band no longer listed here is soft-deleted, so a re-run converges on exactly
`E2E_BANDS` rather than accumulating rows that could overlap.
"""

from __future__ import annotations

from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.examinations import services
from apps.examinations.models import GradeBand, GradingScale, ScaleType
from core.rbac.management.commands.seed_e2e_data import (
    E2E_OTHER_TENANT_SLUG,
    E2E_TENANT_SLUG,
)
from core.tenancy.context import tenant_context
from core.tenancy.models import Tenant

E2E_TENANT_SLUGS = frozenset({E2E_TENANT_SLUG, E2E_OTHER_TENANT_SLUG})

E2E_SCALE_NAME = "E2E Percentage"
# Contiguous at the column's two decimal places — see tests/factories.py's
# STANDARD_BANDS for why the seams are `.99`/`.00` rather than whole numbers.
#
# (label, min_percent, max_percent, is_passing)
E2E_BANDS = (
    ("A", "80.00", "100.00", True),
    ("B", "70.00", "79.99", True),
    ("C", "60.00", "69.99", True),
    ("D", "50.00", "59.99", True),
    ("F", "0.00", "49.99", False),
)


def ensure_e2e_scale(tenant: Tenant) -> GradingScale:
    """The complete default scale for `tenant`, inside its tenant context."""
    scale, _ = GradingScale.objects.alive().get_or_create(
        tenant=tenant,
        name=E2E_SCALE_NAME,
        defaults={"scale_type": ScaleType.PERCENTAGE, "gpa_max": None},
    )
    for sort_order, (label, low, high, passing) in enumerate(E2E_BANDS):
        GradeBand.objects.alive().update_or_create(
            tenant=tenant,
            grading_scale=scale,
            label=label,
            defaults={
                "min_percent": Decimal(low),
                "max_percent": Decimal(high),
                "is_passing": passing,
                "grade_point": None,
                "sort_order": sort_order,
            },
        )
    labels = [label for label, *_ in E2E_BANDS]
    GradeBand.objects.alive().filter(grading_scale=scale).exclude(label__in=labels).update(
        deleted_at=timezone.now()
    )

    services.set_default_scale(scale=scale, actor_id=None)
    # The self-check: a seed that wrote an unusable scale fails here, loudly,
    # rather than in whichever live spec first creates an exam.
    services.assert_scale_usable(scale)
    return scale


class Command(BaseCommand):
    help = "Seed the e2e tenant's complete default grading scale (E2E Percentage)."

    def add_arguments(self, parser) -> None:
        parser.add_argument("--tenant", required=True, help="Tenant slug.")

    def handle(self, *args, **options) -> None:
        slug = options["tenant"]
        if slug not in E2E_TENANT_SLUGS:
            raise CommandError(
                f"Refusing {slug!r}: this seeds e2e data and only runs against "
                f"{sorted(E2E_TENANT_SLUGS)}."
            )
        tenant = Tenant.objects.filter(slug=slug).first()
        if tenant is None:
            raise CommandError(f"No tenant with slug {slug!r}.")

        # `tenant_context` binds `app.tenant_id` for the transaction, which the
        # RLS policy reads — the same reason `fees_finance`'s `seed_finance_accounts` gives.
        with tenant_context(tenant.pk), transaction.atomic():
            scale = ensure_e2e_scale(tenant)
        self.stdout.write(self.style.SUCCESS(f"{tenant.slug}: default scale {scale.name!r}"))
