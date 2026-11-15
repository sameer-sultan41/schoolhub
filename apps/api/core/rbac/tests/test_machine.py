"""Machine-client authentication, scope, throttling and client-IP derivation (decisions 1, 2a).

The public content views arrive in PR C2; until then a test-only view carries the exact
classes `PublicContentView` will declare, so the boundary is proven before any route exists.
"""

from __future__ import annotations

from django.conf import settings
from django.core.cache import cache
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.response import Response
from rest_framework.test import APIClient, APIRequestFactory
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import AccessToken

from apps.school_organization.tests.factories import TenantFactory, UserFactory
from core.api.throttling import PublicFormThrottle
from core.rbac.machine import (
    MACHINE_SCOPES,
    HasMachineScope,
    MachineClientThrottle,
    MachinePrincipal,
    MachineTokenAuthentication,
    client_ip,
)

SCOPE = "website.public-content.view"
NEW, OLD = "renderer-token-new", "renderer-token-old"


class _ProbeView(APIView):
    """The classes `PublicContentView` declares (plan Task C2)."""

    authentication_classes = [MachineTokenAuthentication]
    permission_classes = [HasMachineScope]
    throttle_classes = [MachineClientThrottle]
    required_machine_scope = SCOPE

    def get(self, request) -> Response:
        return Response({"client": request.user.client})


class _UnscopedProbeView(_ProbeView):
    required_machine_scope = "website.page.view"


def call(view: type[APIView], token: str | None = None, host: str = "a.schools.test", **extra):
    factory = APIRequestFactory()
    if token is not None:
        extra["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    return view.as_view()(factory.get("/probe", {"host": host}, **extra))


@override_settings(WEBSITE_MACHINE_TOKENS=f"{NEW},{OLD}")
class MachineTokenAuthenticationTests(SimpleTestCase):
    def setUp(self) -> None:
        cache.clear()

    def test_rotated_tokens_both_accepted(self) -> None:
        for token in (NEW, OLD):
            with self.subTest(token=token):
                response = call(_ProbeView, token)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data, {"client": "website-renderer"})

    def test_wrong_token_401(self) -> None:
        response = call(_ProbeView, "not-a-token")
        self.assertEqual(response.status_code, 401)
        self.assertIn("Bearer", response["WWW-Authenticate"])

    def test_missing_token_401(self) -> None:
        self.assertEqual(call(_ProbeView).status_code, 401)

    def test_token_with_extra_parts_401(self) -> None:
        self.assertEqual(call(_ProbeView, f"{NEW} extra").status_code, 401)

    @override_settings(WEBSITE_MACHINE_TOKENS="")
    def test_empty_token_setting_rejects_everything(self) -> None:
        for token in (NEW, "", " ", ","):
            with self.subTest(token=token):
                self.assertEqual(call(_ProbeView, token).status_code, 401)

    @override_settings(WEBSITE_MACHINE_TOKENS=" , ,")
    def test_blank_entries_are_not_tokens(self) -> None:
        self.assertEqual(call(_ProbeView, ",").status_code, 401)

    def test_scope_missing_403(self) -> None:
        """Authenticated, but the view asks for a scope the client does not hold."""
        self.assertEqual(call(_UnscopedProbeView, NEW).status_code, 403)

    @override_settings(
        MACHINE_CLIENTS={"other": {"tokens_setting": "WEBSITE_MACHINE_TOKENS", "scopes": []}}
    )
    def test_client_without_the_scope_403(self) -> None:
        self.assertEqual(call(_ProbeView, NEW).status_code, 403)

    @override_settings(
        MACHINE_CLIENTS={
            "rogue": {"tokens_setting": "WEBSITE_MACHINE_TOKENS", "scopes": ["fees.report.view"]}
        }
    )
    def test_a_scope_outside_machine_scopes_is_never_granted(self) -> None:
        principal, _ = MachineTokenAuthentication().authenticate(
            APIRequestFactory().get("/", HTTP_AUTHORIZATION=f"Bearer {NEW}")
        )
        self.assertEqual(principal.scopes, frozenset())

    def test_principal_has_no_pk_and_no_tenant(self) -> None:
        principal = MachinePrincipal(client="website-renderer", scopes=frozenset({SCOPE}))
        self.assertTrue(principal.is_authenticated)
        self.assertIsNone(principal.pk)
        self.assertIsNone(principal.tenant_id)


class MachineClientConfigurationTests(SimpleTestCase):
    def test_every_configured_scope_is_a_machine_scope(self) -> None:
        for client, config in settings.MACHINE_CLIENTS.items():
            with self.subTest(client=client):
                self.assertLessEqual(set(config["scopes"]), MACHINE_SCOPES)

    def test_machine_scopes_are_not_role_permissions(self) -> None:
        from core.rbac.registry import registry

        self.assertFalse(MACHINE_SCOPES & {spec.key for spec in registry.all()})

    def test_machine_auth_is_never_a_default(self) -> None:
        defaults = settings.REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"]
        self.assertNotIn("core.rbac.machine.MachineTokenAuthentication", defaults)


@override_settings(WEBSITE_MACHINE_TOKENS=NEW)
class MachineBoundaryTests(TestCase):
    """Review Focus 1 and L63: neither credential crosses into the other's routes."""

    def test_machine_token_rejected_on_cms_routes(self) -> None:
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {NEW}")
        for url in ("/api/v1/website-settings", "/api/v1/website-pages", "/api/v1/themes"):
            with self.subTest(url=url):
                self.assertEqual(client.get(url).status_code, 401)

    def test_staff_jwt_rejected_on_public_routes(self) -> None:
        user = UserFactory(tenant=TenantFactory())
        response = call(_ProbeView, str(AccessToken.for_user(user)))
        self.assertEqual(response.status_code, 401)


@override_settings(WEBSITE_MACHINE_TOKENS=NEW)
class MachineClientThrottleTests(SimpleTestCase):
    def setUp(self) -> None:
        cache.clear()

    def test_renderer_burst_of_reads_not_throttled(self) -> None:
        """100 reads on one host stay well under `machine_client` (1200/min per host)."""
        responses = [call(_ProbeView, NEW, host="burst.schools.test") for _ in range(100)]
        statuses = {response.status_code for response in responses}
        self.assertEqual(statuses, {200})

    def test_bucket_is_per_host(self) -> None:
        throttle = MachineClientThrottle()
        principal = MachinePrincipal(client="website-renderer", scopes=frozenset({SCOPE}))
        keys = set()
        for host in ("a.schools.test", "b.schools.test", "A.schools.test "):
            request = _drf_request(APIRequestFactory().get("/", {"host": host}), principal)
            keys.add(throttle.get_cache_key(request, None))
        self.assertEqual(len(keys), 2)


class ClientIpTests(SimpleTestCase):
    def _request(self, xff: str | None = None, remote: str = "10.0.0.9"):
        extra = {"REMOTE_ADDR": remote}
        if xff is not None:
            extra["HTTP_X_FORWARDED_FOR"] = xff
        return APIRequestFactory().get("/", **extra)

    def test_without_num_proxies_the_header_is_ignored(self) -> None:
        self.assertEqual(client_ip(self._request("203.0.113.7")), "10.0.0.9")

    @override_settings(REST_FRAMEWORK={**settings.REST_FRAMEWORK, "NUM_PROXIES": 1})
    def test_one_proxy_takes_the_address_it_appended(self) -> None:
        request = self._request("198.51.100.1, 203.0.113.7")
        self.assertEqual(client_ip(request), "203.0.113.7")

    @override_settings(REST_FRAMEWORK={**settings.REST_FRAMEWORK, "NUM_PROXIES": 1})
    def test_a_non_address_is_none(self) -> None:
        self.assertIsNone(client_ip(self._request("not-an-ip")))

    @override_settings(REST_FRAMEWORK={**settings.REST_FRAMEWORK, "NUM_PROXIES": 1})
    def test_no_header_falls_back_to_the_peer(self) -> None:
        self.assertEqual(client_ip(self._request()), "10.0.0.9")


@override_settings(REST_FRAMEWORK={**settings.REST_FRAMEWORK, "NUM_PROXIES": 1})
class ForwardedForThrottleTests(SimpleTestCase):
    def setUp(self) -> None:
        cache.clear()

    def test_rotating_xff_does_not_reset_public_form_throttle(self) -> None:
        """The client controls everything left of what our one proxy appended."""
        throttle = PublicFormThrottle()
        allowed = []
        for n in range(throttle.num_requests + 1):
            request = APIRequestFactory().get(
                "/", HTTP_X_FORWARDED_FOR=f"192.0.2.{n}, 203.0.113.7", REMOTE_ADDR="10.0.0.1"
            )
            allowed.append(PublicFormThrottle().allow_request(request, None))
        self.assertEqual(allowed, [True] * throttle.num_requests + [False])


def _drf_request(django_request, user):
    from rest_framework.request import Request

    request = Request(django_request)
    request.user = user
    return request
