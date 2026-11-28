"""Models of the platform console: the plan catalog, each school's subscription and usage.

`Plan` is platform scope (no tenant, no RLS): every school reads the same catalog.
`Subscription` is a school's own row, under RLS like any tenant table, so the platform reads
it only with that one school bound. Platform-wide questions ("is this plan in use?", "which
school is this billing reference?") read the denormalised `tenants.current_plan`,
`subscription_status` and `billing_provider_ref` instead, which the subscription services
write in the same transaction as the row (entities/tenancy.md).
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

from core.tenancy.managers import AppendOnlyQuerySet
from core.tenancy.models import TenantOwnedModel, TenantStatus, TimestampedModel
from core.tenancy.subscription_state import LIVE_STATES


def default_trial_days() -> int:
    """A new plan's trial length, unless it names its own (``PLATFORM_DEFAULT_TRIAL_DAYS``)."""
    return settings.PLATFORM_DEFAULT_TRIAL_DAYS


class BillingPeriod(models.TextChoices):
    MONTHLY = "monthly", "Monthly"
    ANNUAL = "annual", "Annual"


class SubscriptionStatus(models.TextChoices):
    # The live three are `core.tenancy.subscription_state.LIVE_STATES`, which `:reinstate`
    # reads; `test_live_states_are_the_subscription_statuses` pins the two together.
    TRIALING = "trialing", "Trialing"
    ACTIVE = "active", "Active"
    PAST_DUE = "past_due", "Past due"
    CANCELED = "canceled", "Canceled"


class Plan(TimestampedModel):
    """A tier of the catalog: the modules it enables, its limits, price and trial length.

    ``code`` is the stable key: unique, and fixed once created, because `tenants.current_plan`
    holds it. Deleting a plan soft-deletes it, and is refused while any school is on it.
    """

    name = models.CharField(max_length=100)
    code = models.CharField(max_length=50, unique=True, help_text="Stable key; immutable.")
    description = models.TextField(blank=True, default="")
    price_amount = models.DecimalField(
        max_digits=12, decimal_places=2, help_text="Per billing period."
    )
    currency = models.CharField(max_length=3, help_text="ISO 4217; per plan, none assumed.")
    billing_period = models.CharField(
        max_length=10, choices=BillingPeriod.choices, default=BillingPeriod.MONTHLY
    )
    trial_days = models.PositiveIntegerField(default=default_trial_days)
    enabled_modules = models.JSONField(
        default=list, blank=True, help_text="The `module.*` feature keys this tier enables."
    )
    limits = models.JSONField(
        default=dict,
        blank=True,
        help_text="Quota per metric (QUOTA_METRICS): a non-negative integer, or null for none.",
    )
    is_active = models.BooleanField(
        default=True, db_index=True, help_text="Inactive plans take no new subscriber."
    )

    objects = models.Manager()

    class Meta:
        db_table = "plans"
        ordering = ["name"]

    def __str__(self) -> str:
        return self.code


class Subscription(TenantOwnedModel):
    """A school's subscription to a plan. Its billing state drives the school's lifecycle.

    At most one is live (``trialing``, ``active`` or ``past_due``) per school, which a partial
    unique index enforces. A ``canceled`` one is history.
    """

    plan = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name="subscriptions")
    status = models.CharField(
        max_length=20, choices=SubscriptionStatus.choices, default=SubscriptionStatus.TRIALING
    )
    current_period_start = models.DateTimeField()
    current_period_end = models.DateTimeField()
    canceled_at = models.DateTimeField(null=True, blank=True)
    billing_provider = models.CharField(
        max_length=30, blank=True, default="", help_text="The billing adapter's key."
    )
    billing_provider_ref = models.CharField(
        max_length=120,
        blank=True,
        default="",
        help_text="The provider's subscription or customer id; mirrored on the tenant.",
    )
    limits_override = models.JSONField(
        null=True, blank=True, help_text="Negotiated per-school limits, over the plan's."
    )

    class Meta:
        db_table = "subscriptions"
        indexes = [
            models.Index(fields=["tenant", "status"], name="subscriptions_status_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["tenant"],
                condition=Q(status__in=sorted(LIVE_STATES), deleted_at__isnull=True),
                name="subscriptions_one_live_per_tenant",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.tenant_id}: {self.plan_id} ({self.status})"


class BillingOutcome(models.TextChoices):
    APPLIED = "applied", "Applied"
    # Verified, but the subscription's current status could not take it.
    IGNORED = "ignored", "Ignored"
    # Verified, but no school billed through this provider carries the event's reference.
    UNKNOWN_REF = "unknown_ref", "Unknown reference"
    NO_SUBSCRIPTION = "no_subscription", "No live subscription"


class BillingEventReceipt(TimestampedModel):
    """One billing-provider event, received once: the webhook's idempotency record.

    Platform scope (no RLS): it is claimed before the school is known, and an event whose
    reference names no school is still recorded. ``(provider, event_id)`` is unique, so a
    replayed or concurrent duplicate finds the row and does nothing.
    """

    provider = models.CharField(max_length=30)
    event_id = models.CharField(max_length=200)
    kind = models.CharField(max_length=40)
    provider_ref = models.CharField(max_length=120)
    tenant = models.ForeignKey(
        "tenancy.Tenant",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="+",
        help_text="The school the reference named, if any.",
    )
    outcome = models.CharField(max_length=20, choices=BillingOutcome.choices)

    objects = models.Manager()

    class Meta:
        db_table = "billing_event_receipts"
        constraints = [
            models.UniqueConstraint(
                fields=["provider", "event_id"], name="billing_event_receipts_unique_event"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.provider}:{self.event_id} ({self.outcome})"


class TenantUsageSnapshot(models.Model):
    """One school's aggregate usage and plan state at one moment: counts, never rows.

    Platform scope (no RLS): the console and the platform reports read it with no school
    bound (multi-tenancy §8's separate read path). It is written with exactly one school
    bound, by the nightly `snapshot_all` visit or `:refresh-usage` (`usage/services.py`).

    Append-only, as `AppendOnlyTenantModel` is, minus the tenant RLS: ``save()`` of an
    existing row, ``delete()`` and the bulk forms raise, and the migration revokes UPDATE and
    DELETE from the app role (`core.tenancy.grants.PLATFORM_APPEND_ONLY_TABLES`). Retention
    is not built yet (deferred-work.md).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey(
        "tenancy.Tenant", on_delete=models.PROTECT, related_name="+", db_index=False
    )
    taken_at = models.DateTimeField(default=timezone.now)
    status = models.CharField(max_length=20, choices=TenantStatus.choices)
    plan_code = models.CharField(
        max_length=50, blank=True, default="", help_text="The live plan's code; blank for none."
    )
    mrr_amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0"),
        help_text="The plan's price per month while paying (active or past due); 0 otherwise.",
    )
    currency = models.CharField(max_length=3, blank=True, default="")
    students = models.PositiveIntegerField()
    staff = models.PositiveIntegerField()
    storage_bytes = models.PositiveBigIntegerField()
    impersonations_30d = models.PositiveIntegerField(
        null=True, blank=True, help_text="Impersonation grants in the last 30 days (PR E)."
    )
    modules_enabled = models.JSONField(
        default=list, blank=True, help_text="The `module.*` keys on for the school."
    )

    objects = models.Manager.from_queryset(AppendOnlyQuerySet)()

    class Meta:
        db_table = "tenant_usage_snapshots"
        indexes = [
            models.Index(fields=["tenant", "-taken_at"], name="tenant_usage_snapshots_latest"),
        ]

    def __str__(self) -> str:
        return f"{self.tenant_id} @ {self.taken_at:%Y-%m-%d %H:%M}"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise RuntimeError("TenantUsageSnapshot rows are append-only: take a new snapshot.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise RuntimeError("TenantUsageSnapshot rows cannot be deleted.")
