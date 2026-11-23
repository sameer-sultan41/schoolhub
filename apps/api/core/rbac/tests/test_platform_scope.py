"""Platform scope: scoped permission keys, platform roles and the platform route gate (ADR-0036).

No real platform route exists before PR A's Task 3, and the `amr` claim is minted at login
only from Task 2, so these tests mint access tokens by hand and mount probe viewsets through
an override urlconf (this module's `urlpatterns`).
"""

from __future__ import annotations

import io
import itertools
import uuid
from unittest import mock

from django.core.management import call_command
from django.db import IntegrityError, connection, transaction
from django.test import override_settings
from django.urls import path
from rest_framework import status
from rest_framework.response import Response
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from apps.platform_admin.constants import PLATFORM_RESOURCES
from apps.school_organization.tests.factories import TenantFactory, UserFactory, authenticate, grant
from core.api.platform import PlatformTenantNestedMixin, PlatformViewSet
from core.idempotency.models import IdempotencyRecord
from core.rbac.models import Permission, PermissionScope, Role, User, UserRole
from core.rbac.registry import PermissionRegistry, registry
from core.rbac.roles import PLATFORM_ROLES
from core.rbac.seeding import (
    ensure_role_with_permissions,
    ensure_school_owner_role,
    sync_role_permissions,
)
from core.tenancy.context import TENANT_GUC, get_current_tenant_id, tenant_context

# platform-admin.md §4, verbatim.
CONSOLE_KEYS = frozenset(
    {
        "platform.tenant.view",
        "platform.tenant.provision",
        "platform.tenant.update",
        "platform.tenant.suspend",
        "platform.tenant.reinstate",
        "platform.tenant.export",
        "platform.tenant.delete",
        "platform.tenant.impersonate",
        "platform.plan.view",
        "platform.plan.create",
        "platform.plan.update",
        "platform.plan.delete",
        "platform.subscription.view",
        "platform.subscription.update",
        "platform.feature-flag.view",
        "platform.feature-flag.update",
        "platform.migration.import",
        "platform.report.view",
    }
)

_emails = itertools.count()


class ProbeViewSet(PlatformViewSet):
    required_permission = "platform.tenant.view"
    required_permission_map = {"provision": "platform.tenant.provision"}

    def list(self, request):
        return Response({"ok": True})

    def provision(self, request):
        return Response({"ok": True})


class NestedProbeViewSet(PlatformTenantNestedMixin, PlatformViewSet):
    required_permission = "platform.tenant.view"
    required_permission_map = {"act": "platform.tenant.update"}
    executions = 0

    def retrieve(self, request, tenant_pk=None):
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_setting(%s, true)", [TENANT_GUC])
            guc = cursor.fetchone()[0]
        return Response(
            {
                "context": str(get_current_tenant_id()),
                "request_tenant": str(request.tenant.pk),
                "guc": guc,
            }
        )

    def act(self, request, tenant_pk=None):
        def execute() -> Response:
            type(self).executions += 1
            return Response({"run": type(self).executions}, status=status.HTTP_201_CREATED)

        return self.run_idempotent("platform-probe:act", execute)


urlpatterns = [
    path("api/v1/platform/probe", ProbeViewSet.as_view({"get": "list"})),
    path("api/v1/platform/probe:provision", ProbeViewSet.as_view({"post": "provision"})),
    path(
        "api/v1/platform/tenants/<uuid:tenant_pk>/probe",
        NestedProbeViewSet.as_view({"get": "retrieve"}),
    ),
    path(
        "api/v1/platform/tenants/<uuid:tenant_pk>/probe:act",
        NestedProbeViewSet.as_view({"post": "act"}),
    ),
]


def platform_user(
    role_slug: str | None = "platform_super_admin", *, mfa_enabled: bool = True
) -> User:
    """An active platform user holding the synced default `role_slug`, enrolled in MFA."""
    user = User.objects.create_user(
        f"operator{next(_emails)}@platform.test",
        "x-platform-pass-1",
        tenant=None,
        is_platform=True,
        mfa_enabled=mfa_enabled,
    )
    if role_slug:
        UserRole.objects.create(user=user, role=Role.objects.get(tenant=None, slug=role_slug))
    return user


def bearer(user: User, *, amr: list[str] | None = None) -> str:
    """A hand-minted access token; `amr=None` leaves the claim out entirely."""
    token = AccessToken.for_user(user)
    token["tenant_id"] = str(user.tenant_id) if user.tenant_id else None
    token["is_platform"] = user.is_platform
    if amr is not None:
        token["amr"] = amr
    return f"Bearer {token}"


MFA = ["pwd", "otp"]


@override_settings(ROOT_URLCONF=__name__)
class PlatformGateTests(APITestCase):
    def test_tenant_principal_gets_404_on_platform_routes(self) -> None:
        # Review Focus 1: a tenant user, even one whose role holds the tenant-scope
        # `platform.job.view` and whose token claims an `otp`, never learns the console exists.
        tenant_user = UserFactory()
        grant(tenant_user, "platform.job.view")
        self.client.credentials(HTTP_AUTHORIZATION=bearer(tenant_user, amr=MFA))

        for url in (
            "/api/v1/platform/probe",
            f"/api/v1/platform/tenants/{tenant_user.tenant_id}/probe",
        ):
            with self.subTest(url=url):
                response = self.client.get(url)
                self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
                self.assertEqual(response.json()["error"]["code"], "not_found")

        response = self.client.post("/api/v1/platform/probe:provision")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_anonymous_caller_is_401_not_404(self) -> None:
        # Authentication runs before any tenant lookup, so an unknown id is no oracle.
        for url in ("/api/v1/platform/probe", f"/api/v1/platform/tenants/{uuid.uuid4()}/probe"):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, status.HTTP_401_UNAUTHORIZED)

    def test_platform_token_without_otp_amr_is_403_mfa_required(self) -> None:
        operator = platform_user()
        for amr in (None, ["pwd"], "otp", []):
            with self.subTest(amr=amr):
                self.client.credentials(HTTP_AUTHORIZATION=bearer(operator, amr=amr))
                response = self.client.get("/api/v1/platform/probe")
                self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
                self.assertEqual(response.json()["error"]["code"], "mfa_required")

        self.client.credentials(HTTP_AUTHORIZATION=bearer(operator, amr=MFA))
        self.assertEqual(self.client.get("/api/v1/platform/probe").status_code, status.HTTP_200_OK)

    def test_an_otp_token_is_refused_once_mfa_is_off(self) -> None:
        # `create_platform_admin --reset-mfa` turns MFA off; tokens minted before it still
        # carry "otp" until they expire, and must stop opening the console at once.
        operator = platform_user(mfa_enabled=False)
        self.client.credentials(HTTP_AUTHORIZATION=bearer(operator, amr=MFA))

        response = self.client.get("/api/v1/platform/probe")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.json()["error"]["code"], "mfa_required")

    def test_platform_user_without_the_key_is_403(self) -> None:
        operator = platform_user(role_slug=None)
        self.client.credentials(HTTP_AUTHORIZATION=bearer(operator, amr=MFA))

        response = self.client.get("/api/v1/platform/probe")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.json()["error"]["code"], "permission_denied")

    def test_platform_support_cannot_provision(self) -> None:
        support = platform_user("platform_support")
        self.client.credentials(HTTP_AUTHORIZATION=bearer(support, amr=MFA))

        self.assertEqual(self.client.get("/api/v1/platform/probe").status_code, status.HTTP_200_OK)
        response = self.client.post("/api/v1/platform/probe:provision")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.json()["error"]["code"], "permission_denied")

        admin = platform_user("platform_super_admin")
        self.client.credentials(HTTP_AUTHORIZATION=bearer(admin, amr=MFA))
        response = self.client.post("/api/v1/platform/probe:provision")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_nested_route_binds_target_tenant(self) -> None:
        target = TenantFactory()
        TenantFactory()  # another school, never bound
        self.client.credentials(HTTP_AUTHORIZATION=bearer(platform_user(), amr=MFA))

        response = self.client.get(f"/api/v1/platform/tenants/{target.pk}/probe")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        body = response.json()["data"]
        self.assertEqual(body["context"], str(target.pk))
        self.assertEqual(body["request_tenant"], str(target.pk))
        self.assertEqual(body["guc"], str(target.pk))

        response = self.client.get(f"/api/v1/platform/tenants/{uuid.uuid4()}/probe")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_nested_run_idempotent_replays_under_the_target_tenant(self) -> None:
        target = TenantFactory()
        NestedProbeViewSet.executions = 0
        self.client.credentials(HTTP_AUTHORIZATION=bearer(platform_user(), amr=MFA))
        url = f"/api/v1/platform/tenants/{target.pk}/probe:act"

        first = self.client.post(url, {}, format="json", HTTP_IDEMPOTENCY_KEY="key-1")
        second = self.client.post(url, {}, format="json", HTTP_IDEMPOTENCY_KEY="key-1")

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.json()["data"], {"run": 1})
        self.assertEqual(NestedProbeViewSet.executions, 1)
        # Stored under the target tenant: the record is tenant-owned and RLS-bound.
        with tenant_context(target.pk):
            self.assertTrue(
                IdempotencyRecord.objects.filter(
                    key="key-1", endpoint="platform-probe:act"
                ).exists()
            )


class PlatformRoleTests(APITestCase):
    def test_a_default_role_slug_is_unique_among_shared_roles(self) -> None:
        # Shared roles have no tenant; NULLS NOT DISTINCT makes the slug unique among them.
        Role.objects.create(tenant=None, slug="duplicate-default", name="One")
        with self.assertRaises(IntegrityError), transaction.atomic():
            Role.objects.create(tenant=None, slug="duplicate-default", name="Two")

    def test_platform_role_refuses_tenant_user(self) -> None:
        tenant_user = UserFactory()
        platform_role = Role.objects.get(tenant=None, slug="platform_super_admin")
        with self.assertRaises(IntegrityError), transaction.atomic():
            UserRole.objects.create(user=tenant_user, role=platform_role, tenant=tenant_user.tenant)

        # And the converse: a platform user cannot hold a tenant role.
        operator = platform_user(role_slug=None)
        teacher = Role.objects.get(tenant=None, slug="teacher")
        with self.assertRaises(IntegrityError), transaction.atomic():
            UserRole.objects.create(user=operator, role=teacher)

    def test_platform_role_must_be_a_default_role(self) -> None:
        # A platform role is platform-seeded: it never belongs to one school.
        with self.assertRaises(IntegrityError), transaction.atomic():
            Role.objects.create(
                tenant=TenantFactory(), slug="rogue", name="Rogue", is_platform=True
            )

    def test_default_platform_roles_hold_their_section_4_keys(self) -> None:
        for slug in PLATFORM_ROLES:
            role = Role.objects.get(tenant=None, slug=slug)
            with self.subTest(role=slug):
                self.assertTrue(role.is_platform)
                keys = set(role.permissions.values_list("key", flat=True))
                self.assertEqual(keys, set(registry.keys_for_role(slug)))
        support = set(registry.keys_for_role("platform_support"))
        self.assertEqual(
            support,
            {
                "platform.tenant.view",
                "platform.tenant.impersonate",
                "platform.plan.view",
                "platform.subscription.view",
                "platform.feature-flag.view",
                "platform.report.view",
            },
        )
        self.assertEqual(set(registry.keys_for_role("platform_super_admin")), set(CONSOLE_KEYS))


class PermissionScopeTests(APITestCase):
    def test_every_console_key_is_platform_scoped(self) -> None:
        console = {
            spec.key
            for spec in registry.all()
            if spec.module == "platform" and spec.resource in PLATFORM_RESOURCES
        }
        self.assertEqual(console, set(CONSOLE_KEYS))
        for key in console:
            with self.subTest(key=key):
                self.assertEqual(registry.get(key).scope, PermissionScope.PLATFORM)
                self.assertEqual(Permission.objects.get(key=key).scope, PermissionScope.PLATFORM)
        # The tenant-side `platform.*` infrastructure keys share the module name, not the scope.
        for key in ("platform.file.view", "platform.job.view", "platform.notification.view"):
            with self.subTest(key=key):
                self.assertEqual(registry.get(key).scope, PermissionScope.TENANT)
                self.assertEqual(Permission.objects.get(key=key).scope, PermissionScope.TENANT)

    def test_school_owner_gets_no_platform_key(self) -> None:
        role = ensure_school_owner_role()

        scopes = set(role.permissions.values_list("scope", flat=True))
        self.assertEqual(scopes, {PermissionScope.TENANT})
        tenant_keys = Permission.objects.filter(scope=PermissionScope.TENANT)
        self.assertEqual(
            set(role.permissions.values_list("key", flat=True)),
            set(tenant_keys.values_list("key", flat=True)),
        )

        # Review Focus 1: the owner's /auth/me lists no console key.
        owner = UserFactory()
        UserRole.objects.create(user=owner, role=role, tenant=owner.tenant)
        authenticate(self.client, owner)
        response = self.client.get("/api/v1/auth/me")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        listed = response.json()["data"]["permissions"]
        self.assertTrue(listed)
        self.assertFalse([key for key in listed if key in CONSOLE_KEYS])

    def test_sync_role_permissions_refuses_cross_scope_key(self) -> None:
        tenant = TenantFactory()
        tenant_role = ensure_role_with_permissions(tenant, "probe", "Probe", ["platform.job.view"])
        with self.assertRaises(ValueError):
            sync_role_permissions(tenant_role, ["platform.job.view", "platform.tenant.view"])
        with self.assertRaises(ValueError):
            ensure_role_with_permissions(tenant, "probe-2", "Probe", ["platform.tenant.view"])

        platform_role = Role.objects.get(tenant=None, slug="platform_support")
        with self.assertRaises(ValueError):
            sync_role_permissions(platform_role, ["platform.tenant.view", "platform.job.view"])
        # A refused call changes nothing.
        self.assertEqual(
            set(tenant_role.permissions.values_list("key", flat=True)), {"platform.job.view"}
        )

    def test_registry_refuses_a_default_role_of_the_other_scope(self) -> None:
        fresh = PermissionRegistry()
        with self.assertRaises(ValueError):
            fresh.register("platform.tenant.view", "", ("school_owner",), scope="platform")
        with self.assertRaises(ValueError):
            fresh.register("platform.job.view", "", ("platform_support",))
        with self.assertRaises(ValueError):
            fresh.register("platform.job.view", "", (), scope="global")


class CreatePlatformAdminTests(APITestCase):
    def test_creates_a_platform_user_holding_the_role_with_mfa_off(self) -> None:
        with mock.patch(
            "core.rbac.management.commands.create_platform_admin.getpass",
            return_value="correct-horse-battery-staple-9",
        ):
            call_command(
                "create_platform_admin",
                email="Ops@Platform.test",
                first_name="Ops",
                role="platform_support",
                stdout=io.StringIO(),
            )

        user = User.objects.get(email="Ops@platform.test", tenant=None)
        self.assertTrue(user.is_platform)
        self.assertTrue(user.is_active)
        self.assertFalse(user.mfa_enabled)
        self.assertFalse(user.is_staff)
        self.assertTrue(user.check_password("correct-horse-battery-staple-9"))
        self.assertEqual(
            list(UserRole.objects.filter(user=user).values_list("role__slug", flat=True)),
            ["platform_support"],
        )
