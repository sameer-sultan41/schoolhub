"""Tenant model and the base classes every tenant-owned table inherits.

Isolation strategy: shared schema + tenant_id + PostgreSQL Row-Level Security.
See docs/02-architecture/multi-tenancy.md §3.
"""

import uuid

from django.db import models

from core.tenancy.managers import (
    AllTenantsManager,
    AppendOnlyAllTenantsManager,
    AppendOnlyTenantManager,
    TenantScopedManager,
)


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
    hr = models.JSONField(
        default=dict,
        blank=True,
        help_text="HR/staff config, e.g. employee_number_pattern, staff_document_types. "
        "A dedicated namespace rather than folding into `academic` — later "
        "HR/leave and payroll modules (Tier 3/6) have a home here too.",
    )

    objects = TenantScopedManager()
    all_tenants = AllTenantsManager()

    class Meta:
        db_table = "tenant_settings"

    def __str__(self) -> str:
        return f"Settings for {self.tenant_id}"


class TenantScopedModel(models.Model):
    """The tenant dimension, without any opinion on mutability.

    Carries only what makes a row belong to one school: the tenant FK. It exists
    so a table can be tenant-scoped *and* append-only, which the two concrete
    bases below could not both be while the tenant FK lived on only one of them.

    The managers are declared on each concrete base rather than here, because
    the two genuinely differ: ``TenantOwnedModel``'s queryset knows about soft
    delete and offers ``alive()``, and ``AppendOnlyTenantModel``'s must not.

    ``core.tenancy.rls.tenant_owned_tables()`` enumerates subclasses of *this*
    class, so anything tenant-scoped is caught by the RLS coverage check in
    ``tests/test_rls_coverage.py`` no matter which base it picked. Do not
    subclass this directly — pick ``TenantOwnedModel`` or
    ``AppendOnlyTenantModel``.
    """

    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="+", db_index=True)

    class Meta:
        abstract = True


class TenantOwnedModel(TimestampedModel, TenantScopedModel):
    """Base class for every tenant-owned table. The default choice.

    Subclasses automatically get:
      - a non-null tenant_id foreign key,
      - a tenant-scoped default manager (``objects``),
      - an explicitly-named unfiltered manager (``all_tenants``) for platform code only,
      - the full audit column set, including ``deleted_at`` soft delete.

    The database RLS policy — not this manager — is the authoritative boundary.
    """

    objects = TenantScopedManager()
    all_tenants = AllTenantsManager()

    class Meta:
        abstract = True


class AppendOnlyTenantModel(TenantScopedModel):
    """Base class for a tenant-owned table history is never rewritten on.

    Same tenant dimension and RLS coverage as ``TenantOwnedModel``, minus every
    column that implies mutation: no ``updated_at``, no ``updated_by``, and no
    ``deleted_at``. That last omission is not tidiness — **soft delete is an
    UPDATE**, and an append-only table has UPDATE revoked from the application
    role, so the two are mutually exclusive. A row here is inserted once and
    read forever; a mistake is corrected by appending its reversal.

    Enforced at three levels, because each catches what the others miss:

    1. ``save``/``delete`` here, which catch the ordinary instance path.
    2. ``AppendOnlyQuerySet.update``/``delete``, which catch the bulk path that
       never calls ``save`` at all.
    3. ``core.tenancy.grants.append_only_operations`` in the table's migration,
       which revokes UPDATE and DELETE from ``schoolhub_app`` — the only one of
       the three a compromised or careless code path cannot talk its way past.
       ``tests/test_append_only_coverage.py`` fails the build if a table skips it.

    ``core/audit`` is the precedent and its migration carries the argument:
    "an audit trail the application can rewrite is not evidence." The same is
    true of a ledger, which is why ``AuditLog`` could not simply be reused —
    it is platform-scoped, with a nullable tenant and no RLS policy, and money
    is tenant-owned data.

    Subclasses that need exactly one mutable column — a back-reference stamped
    when a later row supersedes this one — list it in ``MUTABLE_FIELDS`` and
    pass the matching ``mutable_columns`` to ``append_only_operations``, which
    emits a column-level ``GRANT UPDATE (col)``. A full-row ``save()`` still
    writes every column and is still refused by the database; only
    ``save(update_fields=[...])`` within the allowance gets through. The two
    declarations must agree, and ``test_append_only_coverage.py`` asserts they do.
    """

    #: Columns a subclass may update in place. Empty means strictly append-only.
    MUTABLE_FIELDS: frozenset[str] = frozenset()

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    created_by = models.UUIDField(null=True, blank=True, editable=False)

    objects = AppendOnlyTenantManager()
    all_tenants = AppendOnlyAllTenantsManager()

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if self.pk and not self._state.adding:
            # An unrestricted save() rewrites every column, which is the one
            # operation this base exists to prevent. A narrowed save() is allowed
            # only within MUTABLE_FIELDS, and the database grant enforces the
            # same narrowing independently.
            fields = set(kwargs.get("update_fields") or ())
            if not fields or not fields <= self.MUTABLE_FIELDS:
                raise RuntimeError(
                    f"{type(self).__name__} rows are append-only. "
                    f"Updatable fields: {sorted(self.MUTABLE_FIELDS) or 'none'}. "
                    "Correct a mistake by appending a reversal "
                    "(AGENTS.md invariant 4)."
                )
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise RuntimeError(
            f"{type(self).__name__} rows cannot be deleted. "
            "Correct a mistake by appending a reversal (AGENTS.md invariant 4)."
        )


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
