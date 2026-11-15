"""Preview tokens and the tenant site URL (plan decision 9)."""

from __future__ import annotations

import time
from unittest import mock

from django.core.signing import BadSignature, SignatureExpired
from django.test import TestCase, override_settings

from apps.website_cms.preview import PREVIEW_TOKEN_MAX_AGE, make_preview_token, read_preview_token
from apps.website_cms.tests.factories import TenantFactory, WebsitePageFactory
from apps.website_cms.urls_builder import tenant_site_url
from core.tenancy.context import tenant_context


class PreviewTokenTests(TestCase):
    def setUp(self) -> None:
        self.tenant = TenantFactory()
        with tenant_context(self.tenant.id):
            self.page = WebsitePageFactory(tenant=self.tenant)

    def test_preview_token_round_trip_and_expiry(self) -> None:
        token = make_preview_token(self.page)
        self.assertEqual(read_preview_token(token), (self.tenant.id, self.page.id))
        later = time.time() + PREVIEW_TOKEN_MAX_AGE + 5
        with (
            mock.patch("django.core.signing.time.time", return_value=later),
            self.assertRaises(SignatureExpired),
        ):
            read_preview_token(token)

    def test_tampered_token_is_rejected(self) -> None:
        with self.assertRaises(BadSignature):
            read_preview_token(make_preview_token(self.page) + "x")

    def test_token_from_another_salt_is_rejected(self) -> None:
        from django.core.signing import TimestampSigner

        forged = TimestampSigner(salt="other").sign(f"{self.tenant.id}:{self.page.id}")
        with self.assertRaises(BadSignature):
            read_preview_token(forged)


class TenantSiteUrlTests(TestCase):
    @override_settings(PLATFORM_DOMAIN="schools.test", DASHBOARD_URL_SCHEME="https")
    def test_preview_url_uses_tenant_host(self) -> None:
        tenant = TenantFactory(slug="greenfield")
        self.assertEqual(
            tenant_site_url(tenant, "/api/preview?token=abc"),
            "https://greenfield.schools.test/api/preview?token=abc",
        )

    def test_relative_path_is_required(self) -> None:
        with self.assertRaises(ValueError):
            tenant_site_url(TenantFactory(), "evil.example")
