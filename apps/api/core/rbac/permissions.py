"""DRF permission classes and the effective-permission resolver."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Mapping
from typing import Any, TypedDict

from django.contrib.auth.models import AbstractBaseUser, AnonymousUser
from django.core.cache import cache
from django.core.exceptions import ImproperlyConfigured
from django.db import models
from django.db.models import Exists, OuterRef, Q, QuerySet
from rest_framework import exceptions, permissions
from rest_framework.request import Request

from core.rbac.cache import scope_grants_cache_key
from core.rbac.models import RecordScope, UserRole

_CACHE_TTL = 300

type RbacUser = AbstractBaseUser | AnonymousUser | None
# permission key -> scope type -> the scope refs of the live assignments granting that key.
type ScopeGrants = Mapping[str, Mapping[str, tuple[uuid.UUID | None, ...]]]


class ScopeKwargs(TypedDict):
    """A table's record-scope settings, as `scope_queryset` and `holds_key_for` take them.

    `TenantScopedViewSetMixin.scope_kwargs()` builds one from a viewset's `scope_*`
    attributes, so a check on a row reads it exactly as that row's viewset does.
    """

    own_field: str | None
    campus_field: str | None
    campus_allows_null: bool


def scope_grants(user: RbacUser) -> ScopeGrants:
    """Each permission key the user holds, mapped to the scopes of the roles that grant it.

    auth-and-rbac.md §2.3 attaches a record scope to a `user_role`, so a scope narrows
    only the keys *its* role grants. Keeping the key next to its scopes is what lets
    a caller ask for one key's reach, where a flat union of every role's scope let an
    unrelated `all` role widen a campus-scoped grant.

    Live assignments of live roles only: a removed assignment or a soft-deleted role
    grants nothing. One query, cached per user as `scope-grants:{pk}` and evicted by
    `core.rbac.cache.evict_rbac_caches` on every role-graph change (signals.py).
    """
    user_id = user.pk if user and user.is_authenticated else None
    if user_id is None:
        return {}

    cache_key = scope_grants_cache_key(user_id)
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    collected: dict[str, dict[str, list[uuid.UUID | None]]] = {}
    rows = UserRole.objects.filter(
        user_id=user_id, deleted_at__isnull=True, role__deleted_at__isnull=True
    ).values_list("role__permissions__key", "scope", "scope_ref")
    for key, scope, ref in rows:
        if key is None:  # a role with no permissions joins to one NULL key
            continue
        refs = collected.setdefault(key, {}).setdefault(scope, [])
        if ref not in refs:
            refs.append(ref)
    grants = {
        key: {scope: tuple(refs) for scope, refs in by_scope.items()}
        for key, by_scope in collected.items()
    }
    cache.set(cache_key, grants, _CACHE_TTL)
    return grants


def effective_permission_keys(user: RbacUser) -> frozenset[str]:
    """Union of permission keys across all of the user's live roles (auth-and-rbac §2.2).

    The key set of `scope_grants`, so keys and scopes come from one query and one
    cache entry and cannot disagree.
    """
    return frozenset(scope_grants(user))


def scopes_for(user: RbacUser, declared: str | AnyOf) -> dict[str, list[uuid.UUID | None]]:
    """The user's record scopes for one route's declaration, keyed by scope type.

    Only the roles that grant a declared key count. For an `AnyOf`, the union over
    the roles granting any of its keys, so the answer does not depend on key order.
    No role granting a declared key means `{}`: the caller fails closed.
    """
    grants = scope_grants(user)
    scopes: dict[str, list[uuid.UUID | None]] = {}
    for key in declared_keys(declared):
        for scope, refs in grants.get(key, {}).items():
            merged = scopes.setdefault(scope, [])
            for ref in refs:
                if ref not in merged:
                    merged.append(ref)
    return scopes


class AnyOf:
    """A declared permission that any one of several keys satisfies.

    ``required_permission_map = {"cancel": AnyOf("a.b.approve", "a.b.create")}``: a route
    with more than one legitimate caller declares them all, so the declaration says what the
    class enforces. An explicit marker rather than a bare tuple, because Django's own
    ``permission_required`` reads an iterable as *all of*, and a stray tuple read that way
    would silently widen access. Needs at least one key, so it can't be written empty.
    """

    __slots__ = ("keys",)

    def __init__(self, *keys: str) -> None:
        if not keys or not all(isinstance(key, str) and key for key in keys):
            raise ImproperlyConfigured("AnyOf takes one or more non-empty permission keys.")
        self.keys = keys


def declared_keys(declared: str | AnyOf) -> tuple[str, ...]:
    """The keys one `required_permission(_map)` value names: a key, or an `AnyOf`'s keys.

    Shared with the contract tests so both read a declaration the same way. Anything else
    (a tuple, a list, None) is a configuration error, not a quietly different meaning.
    """
    if isinstance(declared, str):
        return (declared,)
    if isinstance(declared, AnyOf):
        return declared.keys
    raise ImproperlyConfigured(
        f"A permission declaration is a key or AnyOf(...), not {type(declared).__name__}."
    )


class HasPermissionKey(permissions.BasePermission):
    """Enforces the ``required_permission`` declared on the view.

    Views declare permissions rather than checking inline, so the requirement is
    introspectable: the endpoint-contract tests read every declaration (the OpenAPI
    schema does not publish it). A value is one key, or ``AnyOf(...)`` for a route two
    kinds of caller may use.

    Usage::

        class InvoiceViewSet(TenantModelViewSet):
            required_permission = "fees.invoice.view"
            required_permission_map = {"create": "fees.invoice.create"}
    """

    message = "You do not have permission to perform this action."

    def has_permission(self, request, view) -> bool:
        required = required_declaration(request, view)
        if required is None:
            # Fail closed: an authenticated endpoint with no declared key is a bug.
            return False
        if not request.user or not request.user.is_authenticated:
            return False
        held = effective_permission_keys(request.user)  # one cache read, however many keys
        return any(key in held for key in declared_keys(required))


def required_declaration(request: Request, view: object) -> str | AnyOf | None:
    """The permission one request to ``view`` is declared to need: a key, an `AnyOf`, or None.

    `required_permission_map[action]`, else `required_permission`. `HasPermissionKey`
    enforces it; public so that any other code needing a route's key reads the same
    answer instead of re-deriving it.

    ``view`` is typed ``object`` because only its attributes are read (``action``,
    ``required_permission_map``, ``required_permission``) and the nested-route mixins
    pass ``self``, which mypy cannot see as an ``APIView``. Passing the wrong object
    fails closed: one without the attributes declares nothing, so `HasPermissionKey`
    refuses it (403), the mixin reads `.none()`, and `route_permission` raises
    `PermissionDenied`, never a tenant-wide read. (One carrying another route's
    attributes yields that route's key, so pass the view actually being served.)
    """
    action = getattr(view, "action", None) or request.method.lower()
    mapping = getattr(view, "required_permission_map", None) or {}
    # An action that is in the map is decided by its entry, whatever it holds: an empty
    # string must refuse everyone, not fall back to the resource's (read) key.
    if action in mapping:
        declared: str | AnyOf | None = mapping[action]
        return declared
    fallback: str | AnyOf | None = getattr(view, "required_permission", None)
    return fallback


def route_permission(request: Request, view: object) -> str | AnyOf:
    """`required_declaration` for a request `HasPermissionKey` has already admitted.

    That class refuses a route declaring nothing, so None should not reach a caller
    here; if one does (a view without the class), it is refused rather than read
    under no key at all.
    """
    declared = required_declaration(request, view)
    if declared is None:
        raise exceptions.PermissionDenied()
    return declared


class IsPlatformPrincipal(permissions.BasePermission):
    """Platform-scope endpoints (`/api/v1/platform/...`) only."""

    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(user and user.is_authenticated and user.is_platform)


def live_restricted_role_assignments() -> QuerySet[UserRole]:
    """Every live assignment of a restricted-principal (student or guardian) role.

    The one definition of "holds a restricted role": `is_restricted_principal`
    asks it of one user, and a queryset that must leave students and guardians
    out (`.values("user_id")`) asks it of many, so the two cannot disagree.

    A removed assignment (``deleted_at`` set) or a soft-deleted role does not count,
    matching `scope_grants`: a staff member whose guardian role was removed is staff
    again.
    """
    return UserRole.objects.filter(
        deleted_at__isnull=True,
        role__deleted_at__isnull=True,
        role__is_restricted_principal=True,
    )


def is_restricted_principal(user) -> bool:
    """True for a student or guardian — anyone holding a live restricted-principal role.

    Extracted from `DenyRestrictedPrincipals` so a *queryset* can ask the same
    question the permission class asks. `examinations` needs it because §5.6
    releases a result in two steps: record scope decides *whose* result a caller
    may see, and this decides whether they may see an unpublished one at all.
    Those are different narrowings, and only one of them belongs in a model's
    record-scope hook.

    Reads `live_restricted_role_assignments`, as every restricted-principal
    check does.
    """
    if not user or not getattr(user, "is_authenticated", False):
        return False
    return live_restricted_role_assignments().filter(user_id=user.pk).exists()


class DenyRestrictedPrincipals(permissions.BasePermission):
    """Students and guardians can never reach staff endpoints, even via a custom role."""

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not user or not user.is_authenticated:
            return False
        return not is_restricted_principal(user)


# The narrowing types, in a fixed order so a mixed user's SQL is stable. `all` is
# handled before them, because it narrows nothing.
_NARROWING_SCOPES = (RecordScope.CAMPUS, RecordScope.OWN, RecordScope.ASSIGNED)


def scope_queryset(
    queryset,
    user,
    *,
    permission: str | AnyOf,
    own_field: str | None = None,
    campus_field: str | None = "campus_id",
    campus_allows_null: bool = False,
    assigned_filter=None,
):
    """Narrow a queryset by the user's record scope for one declared permission.

    `permission` is the key (or `AnyOf`) that governs this read, and only the roles
    granting it lend their scope (`scopes_for`): auth-and-rbac.md §2.3 attaches a
    scope to a role assignment, so an unrelated `all` role must not widen a
    campus-scoped grant. It is required, with no default, because a forgotten caller
    falling back to every role's scope is that exact bug. The viewset mixin passes the
    route's own declaration. A write that first resolves a target calls this twice on
    the same queryset, with the target's view key and then the action's
    declaration, so the target is one the caller may both read and act on.

    **A key held at several scope types reads their union** (ADR-0031 decision 7).
    `all`, or a type that passes the queryset through, returns it unchanged. Otherwise
    each type narrows on its own, and a type that can reach nothing (a `campus` role
    with no campus, an `own` or `assigned` with no hook) is empty rather than
    falling through to the next. One type keeps its exact filter; two or more are an
    OR of correlated `EXISTS` subqueries.

    `assigned_filter(queryset, user)` replaces the model's `filter_assigned_to_user`
    for one call, for a reader that needs a narrower `assigned` than the model's
    record reads (attendance reports, which must not see rows only marked by the
    caller).

    Tenant scoping already happened (manager + RLS); this applies the *within-tenant*
    constraint from the role assignment.

    Both `own` and `assigned` delegate to a per-model hook, because neither means one
    thing platform-wide. `own` used to be hardcoded as `own_field == user.pk`, which
    covers a student viewing themself but silently failed the other half of the same
    scope: auth-and-rbac.md §2.3 and every module doc §4 that grants a `guardian` an
    `own`-scoped view key mean "own children", and that needs a join through
    `student_guardians`. `own_field` stays as the fallback for the many models where
    "own" really is a single column.

    A model may define `filter_by_campus(queryset, campus_ids)` when one column
    cannot express the relationship; it takes precedence over `campus_field`.

    `campus_allows_null=True` widens the match to include rows whose campus is
    NULL, for the columns that use NULL to mean "every campus". It is mutually
    exclusive with `filter_by_campus`, which owns the whole predicate and so
    cannot be widened from out here — asking for both raises rather than
    quietly returning the narrow result.

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
    scopes = scopes_for(user, permission)
    if RecordScope.ALL in scopes:
        return queryset
    # One key held at several scope types reads the union of what each type reaches
    # (ADR-0031 decision 7). It used to return at the first of campus > own >
    # assigned, so a campus-A teacher lost the campus-B section they class-teach.
    members: list[QuerySet[Any]] = []
    for scope in _NARROWING_SCOPES:
        if scope not in scopes:
            continue
        member = _narrow_by_scope(
            queryset,
            user,
            scope,
            scopes[scope],
            own_field=own_field,
            campus_field=campus_field,
            campus_allows_null=campus_allows_null,
            assigned_filter=assigned_filter,
        )
        if member is None:
            return queryset
        # A type that reaches nothing adds nothing to the union. Dropping it here,
        # rather than leaving `.none()` inside the OR, is what lets a single remaining
        # type keep its exact filter. Only a literal `.none()` is recognised: a hook
        # whose filter is empty only at run time (`pk__in` an empty subquery) stays in
        # the OR, which is still correct, just not the single-type SQL.
        if not member.query.is_empty():
            members.append(member)
    if not members:
        return queryset.none()
    if len(members) == 1:
        # One type keeps the exact filter it always had, so its SQL is unchanged.
        return members[0]
    # A correlated `EXISTS` per member, ORed: each probe is a primary-key lookup
    # bounded by the outer rows, so a detail read stays a point query. Rather than
    # `a | b`, whose joins can duplicate rows; `union()`, which cannot be filtered
    # further; or uncorrelated `pk__in` subqueries, each evaluated in full (ruling 9).
    match = Q()
    for member in members:
        match |= Q(Exists(member.filter(pk=OuterRef("pk"))))
    return queryset.filter(match)


def _narrow_by_scope(
    queryset: QuerySet[Any],
    user: RbacUser,
    scope: str,
    refs: list[uuid.UUID | None],
    *,
    own_field: str | None,
    campus_field: str | None,
    campus_allows_null: bool,
    assigned_filter: Callable[[QuerySet[Any], RbacUser], QuerySet[Any]] | None,
) -> QuerySet[Any] | None:
    """The rows one scope type reaches, `.none()` if it can reach none, or None when the
    type is already satisfied by tenant scoping and the queryset passes through.

    Each type stands alone: one that can reach nothing (a `campus` role with no
    campus, an `own` or `assigned` with no hook) fails closed rather than falling
    through to the next, because the caller unions every type the key is held at.
    The one pass-through is deliberate and opt-in: `campus` over a table the caller
    declared tenant-wide (`campus_field=None`) returns None, and `scope_queryset`
    then returns the queryset unfiltered (see its docstring).
    """
    if scope == RecordScope.CAMPUS:
        campus_ids = [ref for ref in refs if ref]
        if not campus_ids:
            return queryset.none()
        # A per-model hook first, for the same reason `own` and `assigned`
        # have one: a single field path cannot express every campus
        # relationship. A student transfer has `from_campus_id` *and*
        # `to_campus_id`, and scoping on either alone hides half the queue —
        # the destination campus could not see the incoming transfer it is
        # the one expected to approve.
        by_campus = getattr(queryset.model, "filter_by_campus", None)
        if callable(by_campus):
            # The hook owns the *whole* campus predicate, so the NULL widening
            # below never runs for it. Asking for both is a contradiction, and
            # the way it would fail — the widening silently doing nothing — is
            # the exact silent row-loss this function exists to stop. Say so
            # instead of letting the next model discover it in production.
            if campus_allows_null:
                raise ImproperlyConfigured(
                    f"{queryset.model.__name__} defines filter_by_campus and also asks "
                    "for campus_allows_null, which filter_by_campus cannot honour. "
                    "Express the nullable-campus case inside the hook."
                )
            return by_campus(queryset, campus_ids)
        if campus_field is None:
            return None
        match = Q(**{f"{campus_field}__in": campus_ids})
        if campus_allows_null:
            # A nullable campus column that means "every campus" — the
            # pattern is all over this schema (`departments`, `class_subjects`
            # and `periods` all say so in their own help_text). `IN (...)`
            # drops NULL, so without this a campus-scoped principal loses
            # exactly the rows that *do* apply to them, and nothing errors:
            # the tenant-wide department, the shared curriculum mapping and
            # the lunch break simply are not in the list.
            #
            # `campus_field` verbatim, not stripped of its `_id`: Django
            # resolves `campus_id__isnull` and `campus__isnull` to the same
            # SQL for a ForeignKey, while stripping would turn a plain
            # non-FK `*_id` column (`staff.user_id` is one) into a FieldError.
            match |= Q(**{f"{campus_field}__isnull": True})
        return queryset.filter(match)
    if scope == RecordScope.OWN:
        owned = getattr(queryset.model, "filter_owned_by_user", None)
        if callable(owned):
            return owned(queryset, user)
        if own_field and user is not None:
            return queryset.filter(**{own_field: user.pk})
        return queryset.none()
    # `assigned`: each module defines what it means; it must override this hook.
    assigned = assigned_filter or getattr(queryset.model, "filter_assigned_to_user", None)
    if callable(assigned):
        return assigned(queryset, user)
    return queryset.none()


def holds_key_for(
    user: RbacUser,
    permission: str | AnyOf,
    instance: models.Model,
    *,
    own_field: str | None = None,
    campus_field: str | None = "campus_id",
    campus_allows_null: bool = False,
) -> bool:
    """Whether ``user`` holds ``permission`` for this one row, not merely somewhere.

    "Is the key held at all" is the wrong question for a privilege applied to a
    row: a user holding the key on campus A and an action key at `all` would get
    the privilege on campus B. This is `scope_queryset` over the single row, so the
    key's own scope must reach it. Fails closed: a key not held gives False.

    Pass the scope settings the row's own viewset declares
    (``**SomeViewSet.scope_kwargs()``), so "for this row" means what reading it
    means. The model's default manager is the tenant-scoped one
    (`TenantOwnedModel.objects`), so a row of another tenant, or any row with no
    tenant bound, is never found.
    """
    row = type(instance)._default_manager.filter(pk=instance.pk)
    return bool(
        scope_queryset(
            row,
            user,
            permission=permission,
            own_field=own_field,
            campus_field=campus_field,
            campus_allows_null=campus_allows_null,
        ).exists()
    )
