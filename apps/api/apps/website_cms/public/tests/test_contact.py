"""The anonymous contact POST (Review Focus 2: slug/Origin mismatch) and the tenant CORS rule."""

from __future__ import annotations

from unittest import mock

from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APIClient, APITestCase

from apps.website_cms.constants import CONTACT_MESSAGE_MAX
from apps.website_cms.models import ContactSubmission, CustomDomainStatus
from apps.website_cms.tests.factories import (
    TenantFactory,
    WebsiteSettingsFactory,
    enable_feature,
    make_custom_domain,
)
from core.tenancy.context import tenant_context
from core.tenancy.models import TenantStatus

PLATFORM = "schools.test"
URL = "/api/v1/public/contact-submissions"
NOTIFY = "apps.website_cms.contact_submissions.services.notify_contact_received"


def fields(response) -> list[str]:
    return [row["field"] for row in response.json()["error"]["details"]]


@override_settings(PLATFORM_DOMAIN=PLATFORM)
class ContactPostCase(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        cache.clear()
        self.tenant = self.make_live_tenant("greenfield")
        self.origin = f"https://greenfield.{PLATFORM}"
        self.client = APIClient()  # anonymous: no machine token

    @staticmethod
    def make_live_tenant(slug: str):
        tenant = TenantFactory(slug=slug)
        enable_feature(tenant, "module.website")
        with tenant_context(tenant.id):
            WebsiteSettingsFactory(tenant=tenant, is_published=True)
        return tenant

    def body(self, **overrides):
        fields = {"name": "Amina Khan", "email": "amina@example.test", "message": "Hello"}
        return {**fields, **overrides}

    def post(self, body=None, slug="greenfield", origin="default", **extra):
        headers = {"HTTP_X_TENANT_SLUG": slug, **extra}
        if origin == "default":
            origin = self.origin
        if origin is not None:
            headers["HTTP_ORIGIN"] = origin
        payload = body if body is not None else self.body()
        return self.client.post(URL, payload, format="json", **headers)

    def stored(self, tenant=None) -> int:
        tenant = tenant or self.tenant
        with tenant_context(tenant.id):
            return ContactSubmission.objects.count()


class ContactPostTests(ContactPostCase):
    def test_contact_created_and_notified(self) -> None:
        with mock.patch(NOTIFY) as notify, self.captureOnCommitCallbacks(execute=True):
            response = self.post(HTTP_X_FORWARDED_FOR="9.9.9.9", REMOTE_ADDR="10.1.2.3")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json(), {"status": "received"})
        with tenant_context(self.tenant.id):
            row = ContactSubmission.objects.get()
        self.assertEqual((row.name, row.status, row.ip), ("Amina Khan", "new", "10.1.2.3"))
        notify.delay.assert_called_once()

    def test_slug_origin_mismatch_404(self) -> None:
        self.make_live_tenant("other")

        response = self.post(origin=f"https://other.{PLATFORM}")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.stored(), 0)

    def test_unknown_origin_404(self) -> None:
        self.assertEqual(self.post(origin="https://evil.example").status_code, 404)

    def test_custom_domain_origin_of_the_same_tenant_is_allowed(self) -> None:
        make_custom_domain(self.tenant, "www.greenfield.example", CustomDomainStatus.ACTIVE)

        self.assertEqual(self.post(origin="https://www.greenfield.example").status_code, 201)

    def test_missing_origin_allowed(self) -> None:
        self.assertEqual(self.post(origin=None).status_code, 201)

    def test_unknown_or_missing_slug_404(self) -> None:
        self.assertEqual(self.post(slug="nobody", origin=None).status_code, 404)
        self.assertEqual(self.post(slug="", origin=None).status_code, 404)

    def test_not_operational_module_off_or_unpublished_are_404(self) -> None:
        suspended = self.make_live_tenant("suspended")
        suspended.status = TenantStatus.SUSPENDED
        suspended.save()
        no_module = TenantFactory(slug="nomodule")
        draft = TenantFactory(slug="draft")
        enable_feature(draft, "module.website")
        for slug in ("suspended", "nomodule", "draft"):
            with self.subTest(slug=slug):
                self.assertEqual(self.post(slug=slug, origin=None).status_code, 404)
        self.assertEqual(self.stored(no_module), 0)

    def test_honeypot_returns_201_and_stores_nothing(self) -> None:
        with mock.patch(NOTIFY) as notify, self.captureOnCommitCallbacks(execute=True):
            response = self.post(self.body(company_website="http://spam.example"))

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json(), {"status": "received"})
        self.assertEqual(self.stored(), 0)
        notify.delay.assert_not_called()

    def test_email_or_phone_required(self) -> None:
        response = self.post({"name": "Amina", "message": "Hi"})

        self.assertEqual(response.status_code, 422)
        self.assertIn("email", fields(response))
        with_phone = {"name": "Amina", "message": "Hi", "phone": "+92 300 1234567"}
        self.assertEqual(self.post(with_phone).status_code, 201)

    def test_message_length_cap(self) -> None:
        response = self.post(self.body(message="x" * (CONTACT_MESSAGE_MAX + 1)))

        self.assertEqual(response.status_code, 422)
        self.assertIn("message", fields(response))

    def test_unpublished_source_page_is_422(self) -> None:
        response = self.post(self.body(source_page_id="6f1c1f0e-8d6e-4b8e-9d57-0c1b6c1d2e3f"))

        self.assertEqual(response.status_code, 422)
        self.assertIn("source_page", fields(response))

    def test_idempotent_replay_returns_same_response(self) -> None:
        first = self.post(HTTP_IDEMPOTENCY_KEY="key-1")
        second = self.post(HTTP_IDEMPOTENCY_KEY="key-1")

        self.assertEqual((first.status_code, second.status_code), (201, 201))
        self.assertEqual(first.json(), second.json())
        self.assertEqual(self.stored(), 1)

    def test_ip_throttle_429(self) -> None:
        statuses = [self.post(HTTP_X_FORWARDED_FOR=f"1.1.1.{n}").status_code for n in range(6)]

        self.assertEqual(statuses, [201] * 5 + [429])

    def test_tenant_throttle_429(self) -> None:
        with mock.patch(
            "core.api.throttling.PublicFormTenantThrottle.get_rate", return_value="2/hour"
        ):
            statuses = [self.post(REMOTE_ADDR=f"10.0.0.{n}").status_code for n in range(3)]

        self.assertEqual(statuses, [201, 201, 429])


@override_settings(PLATFORM_DOMAIN=PLATFORM)
class PublicCorsTests(ContactPostCase):
    def preflight(self, origin: str, path: str = URL):
        return self.client.options(
            path,
            HTTP_ORIGIN=origin,
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS="x-tenant-slug,idempotency-key,content-type",
        )

    def test_cors_allows_tenant_origin_only(self) -> None:
        allowed = self.preflight(self.origin)
        denied = self.preflight("https://evil.example")

        self.assertEqual(allowed["Access-Control-Allow-Origin"], self.origin)
        self.assertIn("x-tenant-slug", allowed["Access-Control-Allow-Headers"])
        self.assertIn("idempotency-key", allowed["Access-Control-Allow-Headers"])
        self.assertNotIn("Access-Control-Allow-Origin", denied)

    def test_actual_request_carries_cors_header_for_tenant_origin(self) -> None:
        response = self.post()

        self.assertEqual(response["Access-Control-Allow-Origin"], self.origin)
        self.assertNotIn("Access-Control-Allow-Origin", self.post(origin="https://evil.example"))

    def test_suspended_tenant_origin_not_allowed(self) -> None:
        self.tenant.status = TenantStatus.SUSPENDED
        self.tenant.save()

        self.assertNotIn("Access-Control-Allow-Origin", self.preflight(self.origin))

    def test_cms_paths_are_unaffected(self) -> None:
        response = self.preflight(self.origin, "/api/v1/contact-submissions")

        self.assertNotIn("Access-Control-Allow-Origin", response)
