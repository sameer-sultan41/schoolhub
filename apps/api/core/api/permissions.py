"""Cross-cutting DRF permission classes that are not RBAC-specific.

``core.rbac.permissions`` owns the permission-*key* check (does this user hold
``students.student.view``); this module owns the module-*feature* check (is the
``students`` module even switched on for this tenant) — a different axis, and
per docs/02-architecture/auth-and-rbac.md §2.3 it must run first: "Module-level:
is the module enabled for the tenant (plan/feature flag) — checked before any
permission."
"""

from __future__ import annotations

from rest_framework import permissions


class RequiresModuleFeature(permissions.BasePermission):
    """Enforces the ``required_feature`` declared on the view.

    A view with no ``required_feature`` (``None``, the default) is core platform
    infrastructure — auth, jobs, health checks — and is never gated; only module
    endpoints declare a key. When the flag resolves false, this denies with a
    distinct 403 ``module_disabled`` (``core.api.exceptions.ModuleDisabled``)
    rather than the generic ``permission_denied`` — a tenant whose plan lacks the
    module and a user who lacks one specific permission key are different
    problems, and the client (an upsell prompt vs. "ask an admin") needs to tell
    them apart.
    """

    message = "This module is not enabled for your school."

    def has_permission(self, request, view) -> bool:
        required = getattr(view, "required_feature", None)
        if required is None:
            return True

        tenant = getattr(request, "tenant", None)
        if tenant is None:
            # No tenant bound yet (e.g. anonymous request past IsAuthenticated
            # somehow) — fail closed rather than resolve a flag with no tenant.
            return False

        from core.tenancy.features import is_feature_enabled

        if not is_feature_enabled(required, tenant_id=tenant.pk):
            from core.api.exceptions import ModuleDisabled

            raise ModuleDisabled()
        return True
