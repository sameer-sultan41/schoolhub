"""Contract tests that apply to every endpoint, present and future.

These walk the live URL configuration rather than a hand-maintained list, so a new
endpoint is enrolled automatically. That is the point: the protection cannot be
forgotten by whoever adds the next module.
"""

import ast

from django.test import SimpleTestCase, TestCase
from django.urls import get_resolver
from rest_framework.permissions import AllowAny

from core.rbac.permissions import HasPermissionKey
from core.rbac.registry import registry
from tests.source_tree import source_modules

# Endpoints that are legitimately unauthenticated or permission-free.
EXEMPT_PATTERNS = (
    "healthz",
    "readyz",
    "admin",
    "schema",
    "swagger-ui",
    "api/v1/auth/",
    "api/v1/public/",
)


# DRF's SAFE_METHODS, lower-cased the way `http_method_names` and ViewSet action maps spell them.
SAFE_METHODS = frozenset({"get", "head", "options"})


def _api_routes() -> list[tuple[str, type, dict[str, str] | None]]:
    """Every DRF route under /api/v1/, as (route, view class, method -> action map or None).

    A ViewSet route carries the map it was built with (`{"post": "approve"}`, by a router or by
    an explicit `as_view({...})`); an APIView route has none, and its permission lookup uses
    the HTTP method itself.
    """
    routes: list[tuple[str, type, dict[str, str] | None]] = []

    def walk(resolver, prefix=""):
        for pattern in resolver.url_patterns:
            route = prefix + str(getattr(pattern, "pattern", ""))
            if hasattr(pattern, "url_patterns"):
                walk(pattern, route)
                continue
            callback = getattr(pattern, "callback", None)
            view_class = getattr(callback, "cls", None) or getattr(callback, "view_class", None)
            if view_class is not None:
                routes.append((route, view_class, getattr(callback, "actions", None)))

    walk(get_resolver())
    return [route for route in routes if route[0].startswith("api/v1/")]


def _api_views() -> list[tuple[str, type]]:
    """Every DRF view registered under /api/v1/, as (route, view class)."""
    return [(route, view) for route, view, _ in _api_routes()]


def _is_exempt(route: str) -> bool:
    return any(fragment in route for fragment in EXEMPT_PATTERNS)


class EndpointContractTests(TestCase):
    def test_every_api_view_declares_a_permission_key(self):
        """An endpoint with no declared key fails closed — but that is a bug, not a design."""
        offenders = [
            f"{route} ({view.__name__})"
            for route, view in _api_views()
            if not _is_exempt(route)
            and not getattr(view, "required_permission", None)
            and not getattr(view, "required_permission_map", None)
            and AllowAny not in getattr(view, "permission_classes", [])
        ]
        self.assertEqual(
            offenders,
            [],
            "These endpoints declare no required_permission and would reject every "
            f"request: {offenders}",
        )

    def test_declared_permission_keys_exist_in_the_registry(self):
        """Catches typos: a key that is not registered can never be granted to a role."""
        unknown: list[str] = []
        for route, view in _api_views():
            keys = set(getattr(view, "required_permission_map", {}).values())
            single = getattr(view, "required_permission", None)
            if single:
                keys.add(single)
            unknown.extend(f"{route}: {key}" for key in keys if key not in registry)
        self.assertEqual(unknown, [], f"Unregistered permission keys referenced: {unknown}")

    def test_authenticated_views_enforce_permission_class(self):
        offenders = [
            f"{route} ({view.__name__})"
            for route, view in _api_views()
            if not _is_exempt(route)
            and HasPermissionKey not in getattr(view, "permission_classes", [])
            and AllowAny not in getattr(view, "permission_classes", [])
        ]
        self.assertEqual(offenders, [], f"Endpoints not enforcing HasPermissionKey: {offenders}")


class WritePermissionContractTests(TestCase):
    """A write is never authorised by a read key.

    `HasPermissionKey._required_key` looks the action up in `required_permission_map` and falls
    back to `required_permission` when it is missing. When that fallback is the resource's
    `.view` key, a PATCH or colon-action left out of the map is open to everyone who may *read*
    the resource; when there is no fallback, the route rejects every request. Neither shows up
    in a happy-path test, so this resolves the key for every write route the way the
    permission class does.
    """

    def test_no_write_route_falls_back_to_a_read_key(self):
        offenders: list[str] = []
        for route, view, actions in _api_routes():
            guarded = HasPermissionKey in getattr(view, "permission_classes", [])
            if _is_exempt(route) or not guarded:
                continue
            # A method outside http_method_names is answered 405 whatever the permission says.
            allowed = set(getattr(view, "http_method_names", ())) - SAFE_METHODS
            if actions is None:
                writes = [(method, method) for method in sorted(allowed) if hasattr(view, method)]
            else:
                writes = [(method, name) for method, name in actions.items() if method in allowed]
            mapping = getattr(view, "required_permission_map", None) or {}
            fallback = getattr(view, "required_permission", None)
            for method, action in writes:
                if mapping.get(action):
                    continue
                if fallback is None or fallback.rpartition(".")[2] == "view":
                    offenders.append(
                        f"{method.upper()} {route} ({view.__name__}.{action}) -> {fallback!r}"
                    )
        self.assertEqual(
            offenders,
            [],
            "These write routes are missing from required_permission_map, so they fall back to "
            "required_permission — a read key or none. Map each action to its write key "
            "(schoolhub-backend-module skill, step 4):\n" + "\n".join(offenders),
        )


def _inline_permission_keys() -> list[tuple[str, int, str]]:
    """Every permission-key string literal checked inline in app code.

    `required_permission` / `required_permission_map` are validated through the URLconf above;
    keys checked inside a method body, serializer or task never reach it, so they are found by
    reading the source. Two forms: `has_permission_key(user, "<key>")` (or `key="<key>"`) and
    `"<key>" in effective_permission_keys(user)`.
    """
    found: list[tuple[str, int, str]] = []

    def called(node: ast.AST, name: str) -> bool:
        if not isinstance(node, ast.Call):
            return False
        func = node.func
        return (func.id if isinstance(func, ast.Name) else getattr(func, "attr", None)) == name

    def literal(node: ast.AST | None) -> str | None:
        is_str = isinstance(node, ast.Constant) and isinstance(node.value, str)
        return node.value if is_str else None

    for module in source_modules():
        for node in ast.walk(module.tree):
            key = None
            if called(node, "has_permission_key"):
                positional = node.args[1] if len(node.args) > 1 else None
                keyword = next((kw.value for kw in node.keywords if kw.arg == "key"), None)
                key = literal(positional or keyword)
            elif (
                isinstance(node, ast.Compare)
                and any(isinstance(op, (ast.In, ast.NotIn)) for op in node.ops)
                and any(called(c, "effective_permission_keys") for c in node.comparators)
            ):
                key = literal(node.left)
            if key is not None:
                found.append((module.relative, node.lineno, key))
    return found


class InlinePermissionKeyTests(SimpleTestCase):
    def test_inline_permission_key_literals_exist_in_the_registry(self):
        """A mistyped inline key silently denies (or notifies nobody) — it must be registered."""
        keys = _inline_permission_keys()
        self.assertTrue(keys, "expected at least one inline permission check to verify")
        unregistered = [f"{path}:{line} {key!r}" for path, line, key in keys if key not in registry]
        self.assertEqual(
            unregistered, [], "Unregistered inline permission keys:\n" + "\n".join(unregistered)
        )


class PermissionRegistryTests(TestCase):
    def test_registry_matches_seeded_permission_rows(self):
        """The database seed and the code registry must not drift."""
        from core.rbac.models import Permission

        seeded = set(Permission.objects.values_list("key", flat=True))
        declared = registry.keys()

        self.assertEqual(
            declared - seeded,
            set(),
            f"Registered in code but not seeded in the database: {sorted(declared - seeded)}",
        )
        self.assertEqual(
            seeded - declared,
            set(),
            f"Seeded in the database but no longer declared in code: {sorted(seeded - declared)}",
        )

    def test_every_key_is_well_formed(self):
        for spec in registry.all():
            with self.subTest(key=spec.key):
                self.assertEqual(len(spec.key.split(".")), 3, "Keys must be module.resource.action")
                self.assertEqual(spec.key, spec.key.lower())


class RecordScopeFieldTests(TestCase):
    """`scope_campus_field` must name a field path that actually resolves.

    This is the contract test for a bug that shipped in three modules at once and
    could not be seen from any of them. `TenantScopedViewSetMixin` defaults the
    field to `"campus_id"`, and `scope_queryset` filters on it — so a viewset over
    a table with no campus column raised `FieldError`, a **500**, the moment a
    campus-scoped principal opened the list. `/classes`, `/subjects`, `/houses`,
    `/academic-sessions`, `/terms`, `/campuses` and `/designations` all did.

    Nothing caught it because it needs three things at once: a table with no
    campus dimension, a caller holding `RecordScope.CAMPUS`, and a campus
    reference on the assignment. Every test in the suite used an `all`-scoped
    user, which returns before the campus branch is ever reached.

    Walking the URL conf rather than a list is the point — the next module that
    adds a tenant-wide table is enrolled without anyone remembering to.
    """

    def test_every_campus_scope_field_resolves_on_its_model(self):
        from django.core.exceptions import FieldError
        from django.db.models import QuerySet

        broken = []
        for route, view in _api_views():
            field = getattr(view, "scope_campus_field", None)
            # None is the explicit opt-out for a table with no campus dimension.
            if field is None:
                continue
            queryset = getattr(view, "queryset", None)
            model = getattr(queryset, "model", None)
            if model is None:
                continue
            # Mirrors `scope_queryset`'s own precedence: a model that defines the
            # hook never reaches the field, so the field is not its contract.
            # `StudentTransfer` is the case — two campus columns, no single path.
            if callable(getattr(model, "filter_by_campus", None)):
                continue
            try:
                # Builds the WHERE clause without executing it: field resolution
                # happens in `add_q`, which is exactly what used to blow up.
                QuerySet(model=model).filter(**{f"{field}__in": []})
            except FieldError as exc:
                broken.append(f"{route} ({view.__name__}.scope_campus_field={field!r}): {exc}")

        self.assertEqual(
            broken,
            [],
            "these viewsets would raise FieldError for a campus-scoped user; set "
            "scope_campus_field to a real path, or to None if the table has no "
            "campus dimension:\n" + "\n".join(broken),
        )

    def test_every_own_scope_field_resolves_on_its_model(self):
        """The same trap on the other scope. `scope_own_field` has no default, so
        this is a typo guard rather than a whole missing dimension."""
        from django.core.exceptions import FieldError
        from django.db.models import QuerySet

        broken = []
        for route, view in _api_views():
            field = getattr(view, "scope_own_field", None)
            if not field:
                continue
            queryset = getattr(view, "queryset", None)
            model = getattr(queryset, "model", None)
            if model is None:
                continue
            try:
                QuerySet(model=model).filter(**{field: None})
            except FieldError as exc:
                broken.append(f"{route} ({view.__name__}.scope_own_field={field!r}): {exc}")

        self.assertEqual(broken, [], "\n".join(broken))


class OrderingContractTests(TestCase):
    """Every list endpoint must declare what it can be sorted by, and mean it.

    `OrderingFilter` is a project-wide default, so a list view that declares no
    `ordering_fields` does not get "no sorting" — DRF falls back to every field on the
    serializer. `/designations?ordering=level` worked that way for a while: an
    unindexed, nullable column, sortable by anyone, documented nowhere. §2.4 of
    api-architecture.md says "whitelisted per endpoint"; these tests are what make that
    true rather than aspirational.
    """

    def _list_views(self):
        """Views that expose a list, paired with the model behind them."""
        for route, view in _api_views():
            if _is_exempt(route):
                continue
            queryset = getattr(view, "queryset", None)
            model = getattr(queryset, "model", None)
            if model is None or not hasattr(view, "list"):
                continue
            yield route, view, model

    def test_every_list_declares_what_it_can_be_sorted_by(self):
        offenders = [
            f"{route} ({view.__name__})"
            for route, view, _ in self._list_views()
            if not getattr(view, "ordering_fields", None)
        ]

        self.assertEqual(
            offenders,
            [],
            "These list endpoints declare no ordering_fields, so DRF will accept an "
            "?ordering= on any serializer field — including unindexed and nullable "
            "ones. Declare the allowlist explicitly:\n" + "\n".join(offenders),
        )

    def test_no_ordering_field_traverses_a_relation(self):
        """A `__` here is a 500 waiting for the right principal.

        `scope_queryset` hands OWN/ASSIGNED principals a `.distinct()` queryset, and
        Postgres rejects `SELECT DISTINCT` with an `ORDER BY` on a joined column that is
        not in the select list. The sort works for an admin and raises ProgrammingError
        for a class teacher. Annotate the related field and order by the alias instead —
        an annotation IS in the select list.
        """
        offenders = [
            f"{route} ({view.__name__}.ordering_fields contains {field!r})"
            for route, view, _ in self._list_views()
            for field in getattr(view, "ordering_fields", None) or ()
            if "__" in field
        ]

        self.assertEqual(offenders, [], "\n".join(offenders))

    def test_every_ordering_field_resolves_on_its_model(self):
        """A typo'd allowlist entry is silently dropped by DRF, never reported.

        `remove_invalid_fields` filters the request against the allowlist, but nothing
        checks the allowlist itself against the model. A misspelled entry there fails
        the same silent way a misspelled query parameter does: the list comes back in
        its default order and the header looks broken for no visible reason.
        """
        from django.core.exceptions import FieldError
        from django.db.models import QuerySet

        broken = []
        for route, view, model in self._list_views():
            annotations = set(getattr(view, "ordering_annotations", ()) or ())
            for field in getattr(view, "ordering_fields", None) or ():
                name = field.lstrip("-")
                if name in annotations:
                    continue
                try:
                    QuerySet(model=model).order_by(name)
                except FieldError as exc:
                    broken.append(f"{route} ({view.__name__}): {field!r} — {exc}")

        self.assertEqual(broken, [], "\n".join(broken))
