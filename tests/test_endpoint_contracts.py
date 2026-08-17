"""Contract tests that apply to every endpoint, present and future.

These walk the live URL configuration rather than a hand-maintained list, so a new
endpoint is enrolled automatically. That is the point: the protection cannot be
forgotten by whoever adds the next module.
"""

from django.test import TestCase
from django.urls import get_resolver
from rest_framework.permissions import AllowAny

from core.rbac.permissions import HasPermissionKey
from core.rbac.registry import registry

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


def _api_views() -> list[tuple[str, type]]:
    """Every DRF view registered under /api/v1/, as (route, view class)."""
    views: list[tuple[str, type]] = []

    def walk(resolver, prefix=""):
        for pattern in resolver.url_patterns:
            route = prefix + str(getattr(pattern, "pattern", ""))
            if hasattr(pattern, "url_patterns"):
                walk(pattern, route)
                continue
            callback = getattr(pattern, "callback", None)
            view_class = getattr(callback, "cls", None) or getattr(
                callback, "view_class", None
            )
            if view_class is not None:
                views.append((route, view_class))

    walk(get_resolver())
    return [(route, view) for route, view in views if route.startswith("api/v1/")]


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
        self.assertEqual(
            offenders, [], f"Endpoints not enforcing HasPermissionKey: {offenders}"
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
                self.assertEqual(
                    len(spec.key.split(".")), 3, "Keys must be module.resource.action"
                )
                self.assertEqual(spec.key, spec.key.lower())
