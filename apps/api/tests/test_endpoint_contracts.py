"""Contract tests that apply to every endpoint, present and future.

These walk the live URL configuration rather than a hand-maintained list, so a new
endpoint is enrolled automatically. That is the point: the protection cannot be
forgotten by whoever adds the next module.
"""

import ast

from django.test import SimpleTestCase, TestCase
from django.urls import get_resolver
from rest_framework.permissions import AllowAny

from core.rbac.permissions import AnyOf, HasPermissionKey, declared_keys
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
            keys: set[str] = set()
            for declared in getattr(view, "required_permission_map", {}).values():
                keys.update(declared_keys(declared))
            for single in (
                getattr(view, "required_permission", None),
                getattr(view, "scope_read_permission", None),
            ):
                if single:
                    keys.update(declared_keys(single))
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

    `required_declaration` looks the action up in `required_permission_map` and falls back
    to `required_permission` when it is missing. When that fallback is the resource's
    `.view` key, a PATCH or colon-action left out of the map is open to everyone who may *read*
    the resource; when there is no fallback, the route rejects every request. Neither shows up
    in a happy-path test, so this resolves the key for every write route the way the
    permission class does.
    """

    def test_no_write_route_falls_back_to_a_read_key(self):
        offenders: list[str] = []
        checked = {"viewset": 0, "api_view": 0}
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
            checked["api_view" if actions is None else "viewset"] += len(writes)
            # The fallback may be a key or an `AnyOf`; a falsy one rejects everyone.
            fallback_keys = declared_keys(fallback) if fallback else ()
            for method, action in writes:
                # As in `required_declaration`: an action in the map is decided by its entry.
                if action in mapping:
                    continue
                if not fallback_keys or any(k.rpartition(".")[2] == "view" for k in fallback_keys):
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
        # A detector that finds nothing passes vacuously: if reading the routes' action maps ever
        # broke, every ViewSet would look write-free.
        self.assertGreater(checked["viewset"], 0, f"no ViewSet write routes found: {checked}")
        self.assertGreater(checked["api_view"], 0, f"no APIView write routes found: {checked}")


class AnyOfContractTests(TestCase):
    def test_an_any_of_never_lists_a_read_key(self):
        """A route a read key opens is a read route: `AnyOf` is for writes two callers share."""
        offenders = []
        for route, view in _api_views():
            # Per-action entries and the class-level fallback: both are declarations.
            declared = list((getattr(view, "required_permission_map", None) or {}).values())
            declared.append(getattr(view, "required_permission", None))
            for value in declared:
                if isinstance(value, AnyOf):
                    offenders.extend(
                        f"{route} ({view.__name__}): {key}"
                        for key in value.keys
                        if key.rpartition(".")[2] == "view"
                    )
        self.assertEqual(offenders, [], f"AnyOf lists a read key: {offenders}")


def _module_string_constants() -> dict[str, dict[str, str]]:
    """Each module's top-level `NAME = "<str>"` assignments, by dotted module name."""
    constants: dict[str, dict[str, str]] = {}
    for module in source_modules():
        names = constants.setdefault(module.name, {})
        for node in module.tree.body:
            target = node.target if isinstance(node, ast.AnnAssign) else None
            if isinstance(node, ast.Assign) and len(node.targets) == 1:
                target = node.targets[0]
            value = getattr(node, "value", None)
            if (
                isinstance(target, ast.Name)
                and isinstance(value, ast.Constant)
                and isinstance(value.value, str)
            ):
                names[target.id] = value.value
    return constants


# Calls that return a route's own declaration, which the URLconf tests above validate.
ROUTE_DECLARATION_CALLS = frozenset(
    {"route_permission", "required_declaration", "scope_read_declaration"}
)

# Keys that are data, not code, so no spelling in the source can be checked. Each entry is
# (path, the argument as written); the test fails on an entry that no longer occurs.
DATA_KEY_SITES = frozenset(
    {
        # A leave-approval step's stored key, written by `student_leave_chain` from a
        # registered constant when the step is created.
        ("apps/attendance/services.py", "step.required_permission"),
    }
)

type _Function = ast.FunctionDef | ast.AsyncFunctionDef | ast.Lambda
_FUNCTIONS = (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)


def _parameters(function: _Function) -> set[str]:
    return {node.arg for node in ast.walk(function.args) if isinstance(node, ast.arg)}


def _bindings(function: _Function, name: str) -> list[ast.expr] | None:
    """What `name` is bound to inside `function` (not nested ones), or None if unbound.

    A `for name in (a, b)` binds each element; `name = value` binds the value. A loop over
    anything but a literal tuple or list binds something this check cannot read.
    """
    found: list[ast.expr] = []
    bound = False
    stack = list(ast.iter_child_nodes(function))
    while stack:
        node = stack.pop()
        if isinstance(node, _FUNCTIONS):
            continue
        if isinstance(node, ast.For) and isinstance(node.target, ast.Name):
            if node.target.id == name:
                bound = True
                if isinstance(node.iter, (ast.Tuple, ast.List)):
                    items = ast.iter_child_nodes(node.iter)
                    found.extend(item for item in items if isinstance(item, ast.expr))
                else:
                    found.append(node.iter)
        elif (
            isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == name for target in node.targets)
        ) or (
            isinstance(node, ast.AnnAssign)
            and isinstance(node.target, ast.Name)
            and node.target.id == name
            and node.value is not None
        ):
            bound = True
            found.append(node.value)
        stack.extend(ast.iter_child_nodes(node))
    return found if bound else None


def _resolve_key(
    node: ast.expr,
    functions: list[_Function],
    visible: dict[str, str],
    resolving: frozenset[str] = frozenset(),
) -> tuple[list[str], list[str]]:
    """The keys one key argument names, and the parts of it that cannot be read.

    A literal, a module-level constant (this module's, or imported by name), `AnyOf(...)`
    of those, a route's own declaration (`ROUTE_DECLARATION_CALLS`), a parameter of an
    enclosing function passed through, or a local bound to any of these. Anything else
    (`services.KEY`, a relative import, a local bound to something else) is unreadable.
    """
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return [node.value], []
    if isinstance(node, ast.Call):
        func = node.func
        called = func.id if isinstance(func, ast.Name) else getattr(func, "attr", None)
        if called in ROUTE_DECLARATION_CALLS:
            return [], []
        if called == "AnyOf":
            return _resolve_all(node.args, functions, visible, resolving)
    if isinstance(node, ast.Name) and node.id not in resolving:
        if node.id in visible:
            return [visible[node.id]], []
        for index in range(len(functions) - 1, -1, -1):
            function = functions[index]
            values = _bindings(function, node.id)
            if values is not None:
                # A name bound to itself (`key = key or X`) is not followed twice.
                return _resolve_all(values, functions[: index + 1], visible, resolving | {node.id})
            if node.id in _parameters(function):
                return [], []
    return [], [ast.unparse(node)]


def _resolve_all(
    nodes: list[ast.expr],
    functions: list[_Function],
    visible: dict[str, str],
    resolving: frozenset[str] = frozenset(),
) -> tuple[list[str], list[str]]:
    keys: list[str] = []
    unreadable: list[str] = []
    for node in nodes:
        found, missing = _resolve_key(node, functions, visible, resolving)
        keys.extend(found)
        unreadable.extend(missing)
    return keys, unreadable


def _key_argument(node: ast.Call) -> ast.expr | None:
    """The key a scope or privilege check is asked about, or None for any other call."""
    func = node.func
    called = func.id if isinstance(func, ast.Name) else getattr(func, "attr", None)
    keyword = {kw.arg: kw.value for kw in node.keywords if kw.arg}
    if called in ("holds_key_for", "holds_key_for_row"):
        return node.args[1] if len(node.args) > 1 else keyword.get("permission")
    if called == "scope_queryset":
        return keyword.get("permission")
    if called == "scopes_for":
        return node.args[1] if len(node.args) > 1 else keyword.get("declared")
    return None


def _inline_permission_keys() -> tuple[list[tuple[str, int, str]], list[str]]:
    """Every permission key checked inline in app code, and every one that cannot be read.

    `required_permission` / `required_permission_map` are validated through the URLconf above;
    keys checked inside a method body, serializer or task never reach it, so they are found by
    reading the source: the key argument of `holds_key_for`, `holds_key_for_row`,
    `scope_queryset` (`permission=`) and `scopes_for`, and `"<key>" in
    effective_permission_keys(user)`. `_resolve_key` says which spellings it reads; a
    constant imported by name (`from x import KEY`) resolves to its string, so naming a key
    once does not hide it from this check. Returns `(path, line, key)` for each key read, and
    `"path:line expression"` for each argument that could not be read and is not in
    `DATA_KEY_SITES`.
    """
    found: list[tuple[str, int, str]] = []
    unreadable: list[str] = []
    constants = _module_string_constants()
    for module in source_modules():
        # This module's own constants, then every `from x import NAME` that names one.
        visible = dict(constants.get(module.name, {}))
        for node in ast.walk(module.tree):
            if isinstance(node, ast.ImportFrom) and node.module and not node.level:
                for alias in node.names:
                    value = constants.get(node.module, {}).get(alias.name)
                    if value is not None:
                        visible[alias.asname or alias.name] = value
        _collect_keys(module.tree, [], module.relative, visible, found, unreadable)
    return found, unreadable


def _collect_keys(
    node: ast.AST,
    functions: list[_Function],
    path: str,
    visible: dict[str, str],
    found: list[tuple[str, int, str]],
    unreadable: list[str],
) -> None:
    """Walk `node`, keeping the chain of enclosing functions a local name resolves in."""
    inner = [*functions, node] if isinstance(node, _FUNCTIONS) else functions
    argument: ast.expr | None = None
    if isinstance(node, ast.Call):
        argument = _key_argument(node)
    elif (
        isinstance(node, ast.Compare)
        and any(isinstance(op, (ast.In, ast.NotIn)) for op in node.ops)
        and any(_calls(c, "effective_permission_keys") for c in node.comparators)
    ):
        argument = node.left
    if argument is not None:
        keys, missing = _resolve_key(argument, inner, visible)
        line = getattr(node, "lineno", 0)
        found.extend((path, line, key) for key in keys)
        unreadable.extend(
            f"{path}:{line} {expression}"
            for expression in missing
            if (path, expression) not in DATA_KEY_SITES
        )
    for child in ast.iter_child_nodes(node):
        _collect_keys(child, inner, path, visible, found, unreadable)


def _calls(node: ast.AST, name: str) -> bool:
    if not isinstance(node, ast.Call):
        return False
    func = node.func
    return (func.id if isinstance(func, ast.Name) else getattr(func, "attr", None)) == name


def _data_key_sites_in_use() -> set[tuple[str, str]]:
    """The `DATA_KEY_SITES` entries the source still contains."""
    in_use: set[tuple[str, str]] = set()
    for module in source_modules():
        for node in ast.walk(module.tree):
            argument = _key_argument(node) if isinstance(node, ast.Call) else None
            if argument is not None and (module.relative, ast.unparse(argument)) in DATA_KEY_SITES:
                in_use.add((module.relative, ast.unparse(argument)))
    return in_use


class InlinePermissionKeyTests(SimpleTestCase):
    def test_inline_permission_key_literals_exist_in_the_registry(self):
        """A mistyped inline key silently denies (or notifies nobody) — it must be registered."""
        keys, _ = _inline_permission_keys()
        self.assertTrue(keys, "expected at least one inline permission check to verify")
        unregistered = [f"{path}:{line} {key!r}" for path, line, key in keys if key not in registry]
        self.assertEqual(
            unregistered, [], "Unregistered inline permission keys:\n" + "\n".join(unregistered)
        )

    def test_every_inline_permission_key_can_be_read(self):
        """A key this check cannot read is a key it cannot verify, so it is refused rather
        than skipped. Spell it as a literal, a constant imported by name, or a parameter
        passed through; a key that is data goes in `DATA_KEY_SITES` with its reason."""
        _, unreadable = _inline_permission_keys()
        self.assertEqual(
            unreadable,
            [],
            "Inline permission keys this test cannot read:\n" + "\n".join(unreadable),
        )

    def test_every_data_key_site_still_exists(self):
        """`DATA_KEY_SITES` may only shrink: an entry whose call is gone must be removed."""
        self.assertEqual(_data_key_sites_in_use(), set(DATA_KEY_SITES))


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
