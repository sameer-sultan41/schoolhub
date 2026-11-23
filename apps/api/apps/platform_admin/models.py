"""Models of the platform console: the plan catalog and each school's subscription.

`Plan` is platform scope (no tenant, no RLS): every school reads the same catalog.
`Subscription` is a school's own row, under RLS like any tenant table, so the platform reads
it only with that one school bound. Platform-wide questions ("is this plan in use?", "which
school is this billing reference?") read the denormalised `tenants.current_plan`,
`subscription_status` and `billing_provider_ref` instead, which the subscription services
write in the same transaction as the row (entities/tenancy.md).
"""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.db.models import Q

from core.tenancy.models import TenantOwnedModel, TimestampedModel
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
