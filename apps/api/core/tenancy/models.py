"""Tenant model and the base classes every tenant-owned table inherits.

Isolation strategy: shared schema + tenant_id + PostgreSQL Row-Level Security.
See docs/02-architecture/multi-tenancy.md §3.
"""

import uuid

from django.db import models

from core.tenancy.managers import AllTenantsManager, TenantScopedManager


class TenantStatus(models.TextChoices):
    PROVISIONING = "provisioning", "Provisioning"
    TRIAL = "trial", "Trial"
    ACTIVE = "active", "Active"
    PAST_DUE = "past_due", "Past due"
    SUSPENDED = "suspended", "Suspended"
    DEPROVISIONED = "deprovisioned", "Deprovisioned"


class TimestampedModel(models.Model):
    """Audit columns required on every table (database-architecture.md §column conventions)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.UUIDField(null=True, blank=True, editable=False)
    updated_by = models.UUIDField(null=True, blank=True, editable=False)
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        abstract = True

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None


class Tenant(TimestampedModel):
    """One school organization. Platform-scope: this table has no tenant_id and no RLS policy."""

    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=63, unique=True, help_text="Wildcard subdomain label.")
    status = models.CharField(
        max_length=20, choices=TenantStatus.choices, default=TenantStatus.PROVISIONING
    )
    timezone = models.CharField(max_length=64, default="UTC")
    locale = models.CharField(max_length=10, default="en")
    currency = models.CharField(max_length=3, default="USD")
    trial_ends_at = models.DateTimeField(null=True, blank=True)
    suspended_at = models.DateTimeField(null=True, blank=True)

    # Platform-scope table: the unfiltered manager is the only manager.
    objects = models.Manager()

    class Meta:
        db_table = "tenants"
        ordering = ["name"]

    def __str__(self) -> str:
        return f"{self.name} ({self.slug})"

    @property
    def is_operational(self) -> bool:
        return self.status in {TenantStatus.TRIAL, TenantStatus.ACTIVE, TenantStatus.PAST_DUE}


class TenantSettings(TimestampedModel):
    """Per-tenant configuration and branding. One row per tenant."""

    tenant = models.OneToOneField(Tenant, on_delete=models.CASCADE, related_name="settings")
    branding = models.JSONField(default=dict, blank=True)
    academic = models.JSONField(default=dict, blank=True)
    features = models.JSONField(default=dict, blank=True)

    objects = TenantScopedManager()
    all_tenants = AllTenantsManager()

    class Meta:
        db_table = "tenant_settings"

    def __str__(self) -> str:
        return f"Settings for {self.tenant_id}"


class TenantOwnedModel(TimestampedModel):
    """Base class for every tenant-owned table.

    Subclasses automatically get:
      - a non-null tenant_id foreign key,
      - a tenant-scoped default manager (``objects``),
      - an explicitly-named unfiltered manager (``all_tenants``) for platform code only.

    The database RLS policy — not this manager — is the authoritative boundary.
    """

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="+", db_index=True)

    objects = TenantScopedManager()
    all_tenants = AllTenantsManager()

    class Meta:
        abstract = True


class FeatureFlag(TimestampedModel):
    """A server-checked module/feature switch. Platform-scope: code-defined, like Permission.

    Flags are registered in code (``core.tenancy.features.FeatureRegistry``) and
    synced into this table on ``post_migrate``, the same pattern
    ``core.rbac.registry``/``sync`` uses for permission keys — so the registry and
    the database can never drift. This table itself carries no ``tenant_id`` and no
    RLS policy, matching ``Permission``/``Tenant``: it is not tenant-owned data.
    """

    key = models.CharField(max_length=100, unique=True, help_text="e.g. 'module.students'.")
    description = models.CharField(max_length=255, blank=True)
    default_enabled = models.BooleanField(
        default=False, help_text="Resolved value when no tenant override applies."
    )
    is_kill_switch = models.BooleanField(
        default=False,
        help_text="When true, a tenant override can never turn this ON — only the "
        "platform default can enable it. Overrides may still force it off.",
    )

    objects = models.Manager()

    class Meta:
        db_table = "feature_flags"
        ordering = ["key"]

    def __str__(self) -> str:
        return self.key


class TenantFeatureOverride(TenantOwnedModel):
    """A per-tenant override of a FeatureFlag's resolved value, with an audit trail."""

    feature_flag = models.ForeignKey(
        FeatureFlag, on_delete=models.PROTECT, related_name="tenant_overrides"
    )
    enabled = models.BooleanField()
    reason = models.TextField()
    expires_at = models.DateTimeField(
        null=True, blank=True, help_text="Null means the override never expires."
    )

    class Meta:
        db_table = "tenant_feature_overrides"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "feature_flag"],
                name="tenant_feature_overrides_unique_flag_per_tenant",
                condition=models.Q(deleted_at__isnull=True),
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "feature_flag"], name="tenant_feat_override_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.feature_flag_id} -> {self.enabled} ({self.tenant_id})"


class TenantCounter(TenantOwnedModel):
    """A gapless per-tenant sequence, allocated under a row lock (database-architecture.md §4).

    ``scope`` names what is being numbered (e.g. "admission_number"); ``series`` is
    the rendered, non-sequence part of the pattern (e.g. a campus+year prefix), so
    the same scope can run independent sequences per series without a second table.
    An empty string is a valid series: it means the pattern has no such prefix.
    """

    scope = models.CharField(max_length=32)
    series = models.CharField(max_length=64, blank=True)
    next_value = models.PositiveBigIntegerField(default=1)

    class Meta:
        db_table = "tenant_counters"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "scope", "series"],
                name="tenant_counters_unique_series_per_tenant",
                condition=models.Q(deleted_at__isnull=True),
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "scope"], name="tenant_counters_scope_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.scope}:{self.series or '-'} @ {self.next_value} ({self.tenant_id})"
