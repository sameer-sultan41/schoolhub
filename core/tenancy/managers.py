"""Managers implementing the application-layer half of tenant isolation.

Defense in depth: RLS in the database is authoritative, these managers make the
common path correct and make bypassing it explicit and greppable.
"""

from django.db import models

from core.tenancy.context import get_current_tenant_id


class TenantScopedQuerySet(models.QuerySet):
    def alive(self):
        """Exclude soft-deleted rows."""
        return self.filter(deleted_at__isnull=True)

    def dead(self):
        return self.filter(deleted_at__isnull=False)


class TenantScopedManager(models.Manager.from_queryset(TenantScopedQuerySet)):
    """Default manager for tenant-owned models: filters to the active tenant.

    When no tenant is active the queryset is empty rather than global — failing
    closed is the right default for a multi-tenant system, and platform code that
    genuinely needs cross-tenant access must say so via ``all_tenants``.
    """

    def get_queryset(self):
        queryset = super().get_queryset()
        tenant_id = get_current_tenant_id()
        if tenant_id is None:
            return queryset.none()
        return queryset.filter(tenant_id=tenant_id)


class AllTenantsManager(models.Manager.from_queryset(TenantScopedQuerySet)):
    """Unfiltered manager. Platform-scope code only.

    Every use is a security decision: RLS still applies unless the connection role
    is a platform role, so this manager alone does not grant cross-tenant reads.
    """
