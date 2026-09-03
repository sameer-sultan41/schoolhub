"""DRF permission classes and the effective-permission resolver."""

from __future__ import annotations

from django.core.cache import cache
from rest_framework import permissions

from core.rbac.models import RecordScope

_CACHE_TTL = 300


def effective_permission_keys(user) -> frozenset[str]:
    """Union of permission keys across all of the user's roles.

    Cached per user; invalidated by role/permission mutations (see signals.py).
    """
    if not user or not user.is_authenticated:
        return frozenset()

    cache_key = f"perm-keys:{user.pk}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    keys = frozenset(
        user.user_roles.filter(deleted_at__isnull=True)
        .values_list("role__permissions__key", flat=True)
        .exclude(role__permissions__key=None)
    )
    cache.set(cache_key, keys, _CACHE_TTL)
    return keys


def user_scopes(user) -> dict[str, list]:
    """Record scopes granted to the user, keyed by scope type.

    Cached per user, mirroring effective_permission_keys above — a serializer
    calling this once per row in a list response (see
    student_management/serializers.py's _can_see_medical_notes) would otherwise
    issue one fresh query per row for the identical requesting user.
    core/rbac/signals.py's _evict already runs on every UserRole change (the
    only source of scope/scope_ref), so it evicts this cache key too.
    """
    if not user or not user.is_authenticated:
        return {}

    cache_key = f"scopes:{user.pk}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    scopes: dict[str, list] = {}
    for scope, ref in user.user_roles.filter(deleted_at__isnull=True).values_list(
        "scope", "scope_ref"
    ):
        scopes.setdefault(scope, []).append(ref)
    cache.set(cache_key, scopes, _CACHE_TTL)
    return scopes


def has_permission_key(user, key: str) -> bool:
    return key in effective_permission_keys(user)


class HasPermissionKey(permissions.BasePermission):
    """Enforces the ``required_permission`` declared on the view.

    Views declare permissions rather than checking inline, so the requirement is
    introspectable — it is published in the OpenAPI schema and asserted by the
    RBAC matrix tests.

    Usage::

        class InvoiceViewSet(TenantModelViewSet):
            required_permission = "fees.invoice.view"
            required_permission_map = {"create": "fees.invoice.create"}
    """

    message = "You do not have permission to perform this action."

    def has_permission(self, request, view) -> bool:
        required = self._required_key(request, view)
        if required is None:
            # Fail closed: an authenticated endpoint with no declared key is a bug.
            return False
        if not request.user or not request.user.is_authenticated:
            return False
        return has_permission_key(request.user, required)

    @staticmethod
    def _required_key(request, view) -> str | None:
        action = getattr(view, "action", None) or request.method.lower()
        mapping = getattr(view, "required_permission_map", None) or {}
        return mapping.get(action) or getattr(view, "required_permission", None)


class IsPlatformPrincipal(permissions.BasePermission):
    """Platform-scope endpoints (`/api/v1/platform/...`) only."""

    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(user and user.is_authenticated and user.is_platform)


class DenyRestrictedPrincipals(permissions.BasePermission):
    """Students and guardians can never reach staff endpoints, even via a custom role."""

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not user or not user.is_authenticated:
            return False
        return not user.user_roles.filter(role__is_restricted_principal=True).exists()


def scope_queryset(queryset, user, *, own_field: str | None = None, campus_field="campus_id"):
    """Narrow a queryset by the user's record scope.

    Tenant scoping already happened (manager + RLS); this applies the *within-tenant*
    constraint from the role assignment.
    """
    scopes = user_scopes(user)
    if RecordScope.ALL in scopes:
        return queryset
    if RecordScope.CAMPUS in scopes:
        campus_ids = [ref for ref in scopes[RecordScope.CAMPUS] if ref]
        if campus_ids:
            return queryset.filter(**{f"{campus_field}__in": campus_ids})
    if RecordScope.OWN in scopes and own_field:
        return queryset.filter(**{own_field: user.pk})
    if RecordScope.ASSIGNED in scopes:
        # Each module defines what "assigned" means; it must override this hook.
        assigned = getattr(queryset.model, "filter_assigned_to_user", None)
        if callable(assigned):
            return assigned(queryset, user)
    return queryset.none()
