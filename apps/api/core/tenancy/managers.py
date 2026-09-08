"""Managers implementing the application-layer half of tenant isolation.

Defense in depth: RLS in the database is authoritative, these managers make the
common path correct and make bypassing it explicit and greppable.

Two families live here. The ``TenantScoped*`` pair serves soft-deletable tables
(``TenantOwnedModel``) and offers ``alive()``/``dead()``. The ``AppendOnly*``
pair serves append-only tables (``AppendOnlyTenantModel``) and deliberately does
not: those tables have no ``deleted_at`` column, so ``alive()`` there would be a
``FieldError`` at request time — and, worse, adding one later would make a
soft-delete look supported on a table whose UPDATE grant is revoked.
"""

from django.db import models

from core.tenancy.context import get_current_tenant_id


class _TenantFilteredManagerMixin:
    """The fail-closed tenant filter, shared by every scoped manager.

    Extracted rather than copied: these five lines are the entire application
    half of tenant isolation, and a second copy is a second place for it to be
    got wrong.
    """

    def get_queryset(self):
        queryset = super().get_queryset()
        tenant_id = get_current_tenant_id()
        if tenant_id is None:
            return queryset.none()
        return queryset.filter(tenant_id=tenant_id)


class TenantScopedQuerySet(models.QuerySet):
    def alive(self):
        """Exclude soft-deleted rows."""
        return self.filter(deleted_at__isnull=True)

    def dead(self):
        return self.filter(deleted_at__isnull=False)


class AppendOnlyQuerySet(models.QuerySet):
    """Queryset for append-only tables.

    No ``alive()``/``dead()`` on purpose — see the module docstring. It also
    refuses the three bulk mutations that walk straight past the model's own
    ``save``/``delete`` guards — ``update()``, ``delete()`` and
    ``bulk_update()``, the last of which builds its own UPDATE independently of
    ``update()`` and so needs its own override. The database grant is the real
    boundary, but a ``RuntimeError`` naming the reversal route is a far better
    developer experience than a bare ``permission denied for table`` from
    PostgreSQL.
    """

    def update(self, **kwargs):
        raise RuntimeError(
            f"{self.model.__name__} is append-only: rows are never updated. "
            "Correct a mistake by appending a reversal, not by rewriting history "
            "(AGENTS.md invariant 4)."
        )

    def delete(self):
        raise RuntimeError(
            f"{self.model.__name__} is append-only: rows are never deleted. "
            "Correct a mistake by appending a reversal (AGENTS.md invariant 4)."
        )

    def bulk_update(self, objs, fields, batch_size=None):
        raise RuntimeError(
            f"{self.model.__name__} is append-only: rows are never updated, in bulk or "
            "otherwise. bulk_update() builds its own UPDATE independently of update() and "
            "would walk straight past that guard if this override did not exist. Correct "
            "a mistake by appending a reversal, not by rewriting history "
            "(AGENTS.md invariant 4)."
        )


class TenantScopedManager(
    _TenantFilteredManagerMixin, models.Manager.from_queryset(TenantScopedQuerySet)
):
    """Default manager for tenant-owned models: filters to the active tenant.

    When no tenant is active the queryset is empty rather than global — failing
    closed is the right default for a multi-tenant system, and platform code that
    genuinely needs cross-tenant access must say so via ``all_tenants``.
    """


class AllTenantsManager(models.Manager.from_queryset(TenantScopedQuerySet)):
    """Unfiltered manager. Platform-scope code only.

    Every use is a security decision: RLS still applies unless the connection role
    is a platform role, so this manager alone does not grant cross-tenant reads.
    """


class AppendOnlyTenantManager(
    _TenantFilteredManagerMixin, models.Manager.from_queryset(AppendOnlyQuerySet)
):
    """Default manager for append-only tenant-owned models."""


class AppendOnlyAllTenantsManager(models.Manager.from_queryset(AppendOnlyQuerySet)):
    """Unfiltered manager for append-only models. Platform-scope code only."""
