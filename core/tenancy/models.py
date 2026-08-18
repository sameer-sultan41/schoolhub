"""Tenant model and the base classes every tenant-owned table inherits.

Isolation strategy: shared schema + tenant_id + PostgreSQL Row-Level Security.
See schoolhub-srd/docs/02-architecture/multi-tenancy.md §3.
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
