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


def scope_queryset(
    queryset,
    user,
    *,
    own_field: str | None = None,
    campus_field: str | None = "campus_id",
):
    """Narrow a queryset by the user's record scope.

    Tenant scoping already happened (manager + RLS); this applies the *within-tenant*
    constraint from the role assignment.

    Both `own` and `assigned` delegate to a per-model hook, because neither means one
    thing platform-wide. `own` used to be hardcoded as `own_field == user.pk`, which
    covers a student viewing themself but silently failed the other half of the same
    scope: auth-and-rbac.md §2.3 and every module doc §4 that grants a `guardian` an
    `own`-scoped view key mean "own children", and that needs a join through
    `student_guardians`. `own_field` stays as the fallback for the many models where
    "own" really is a single column.

    **`campus_field=None` means the table has no campus dimension at all.** Classes,
    subjects and houses are defined once for a school and used by every campus —
    there is no column to narrow on and no join that would invent one. Without this,
    the default `"campus_id"` produced a `FieldError` (a 500) the moment a
    campus-scoped principal opened `/classes`, because the filter named a column that
    does not exist. Returning `.none()` instead would be worse in a quieter way: a
    campus admin who cannot see "Grade 6" cannot create a section in it.

    So a campus scope over a tenant-wide table is *already satisfied* by tenant
    scoping, and the queryset passes through. That is a narrowing decision, so it is
    stated at the call site — each viewset opting out says so — rather than inferred
    by catching FieldError, which would also swallow a genuine typo in a real path.
    """
    scopes = user_scopes(user)
    if RecordScope.ALL in scopes:
        return queryset
    if RecordScope.CAMPUS in scopes:
        campus_ids = [ref for ref in scopes[RecordScope.CAMPUS] if ref]
        if campus_ids and campus_field is None:
            return queryset
        if campus_ids:
            return queryset.filter(**{f"{campus_field}__in": campus_ids})
    if RecordScope.OWN in scopes:
        owned = getattr(queryset.model, "filter_owned_by_user", None)
        if callable(owned):
            return owned(queryset, user)
        if own_field:
            return queryset.filter(**{own_field: user.pk})
    if RecordScope.ASSIGNED in scopes:
        # Each module defines what "assigned" means; it must override this hook.
        assigned = getattr(queryset.model, "filter_assigned_to_user", None)
        if callable(assigned):
            return assigned(queryset, user)
    return queryset.none()
