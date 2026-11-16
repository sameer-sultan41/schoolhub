"""Shared setup for the platform console's tests: operators, their tokens and tenants."""

from __future__ import annotations

import itertools

from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from core.rbac.models import Role, User, UserRole
from core.rbac.permissions import FIRST_FACTOR_AMR, OTP_AMR
from core.rbac.tests.link_helpers import LINK_SETTINGS
from core.tenancy.models import Tenant, TenantStatus

TENANTS_URL = "/api/v1/platform/tenants"

_sequence = itertools.count()


def platform_user(role_slug: str | None = "platform_super_admin") -> User:
    """An active platform user holding the synced default ``role_slug``."""
    user = User.objects.create_user(
        f"operator{next(_sequence)}@platform.test",
        "x-platform-pass-1",
        tenant=None,
        is_platform=True,
    )
    if role_slug:
        UserRole.objects.create(user=user, role=Role.objects.get(tenant=None, slug=role_slug))
    return user


def bearer(user: User, *, amr: tuple[str, ...] = (FIRST_FACTOR_AMR, OTP_AMR)) -> str:
    """An access token as `/auth/mfa:verify` issues it: password and TOTP passed."""
    token = AccessToken.for_user(user)
    token["tenant_id"] = str(user.tenant_id) if user.tenant_id else None
    token["is_platform"] = user.is_platform
    token["amr"] = list(amr)
    return f"Bearer {token}"


def make_tenant(*, status: str = TenantStatus.PROVISIONING, **fields) -> Tenant:
    """A tenant row as `POST /platform/tenants` leaves it, at ``status``."""
    n = next(_sequence)
    defaults = {
        "name": f"Platform School {n}",
        "slug": f"platform-school-{n}",
        "contact_name": "Amina Khan",
        "contact_email": f"owner{n}@school.test",
        "contact_phone": "+923000000000",
    }
    return Tenant.objects.create(status=status, **{**defaults, **fields})


def tenant_url(tenant: Tenant, action: str = "") -> str:
    return f"{TENANTS_URL}/{tenant.pk}{action}"


@override_settings(**LINK_SETTINGS)
class PlatformAPITestCase(APITestCase):
    """Signed in as a `platform_super_admin` with an MFA-verified token."""

    def setUp(self) -> None:
        super().setUp()
        cache.clear()
        self.operator = platform_user()
        self.client.credentials(HTTP_AUTHORIZATION=bearer(self.operator))

    def sign_in_as(self, user: User) -> None:
        self.client.credentials(HTTP_AUTHORIZATION=bearer(user))

    def assert_error(self, response, status_code: int, code: str) -> None:
        self.assertEqual(response.status_code, status_code, response.content)
        self.assertEqual(response.json()["error"]["code"], code)
