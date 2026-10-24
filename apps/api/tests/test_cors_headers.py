"""The browser preflight lets the dashboard's own request headers through.

The dashboard calls the API cross-origin, so the browser asks first (an OPTIONS preflight)
and refuses to send any header the answer doesn't list. A header left off fails the request
before it reaches a view, which the dashboard can only report as an unreachable server.
"""

from __future__ import annotations

from django.test import SimpleTestCase, override_settings

DASHBOARD_ORIGIN = "http://dashboard.test"


@override_settings(CORS_ALLOWED_ORIGINS=[DASHBOARD_ORIGIN], CORS_ALLOWED_ORIGIN_REGEXES=[])
class CorsPreflightTests(SimpleTestCase):
    def allowed_headers(self, requested_headers: str) -> set[str]:
        response = self.client.options(
            "/api/v1/student-attendance:bulk-mark",
            HTTP_ORIGIN=DASHBOARD_ORIGIN,
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS=requested_headers,
        )
        self.assertEqual(response.headers["Access-Control-Allow-Origin"], DASHBOARD_ORIGIN)
        value = response.headers["Access-Control-Allow-Headers"]
        return {header.strip().lower() for header in value.split(",")}

    def test_the_idempotency_key_header_is_allowed(self) -> None:
        allowed = self.allowed_headers("authorization, content-type, idempotency-key")

        self.assertIn("idempotency-key", allowed)

    def test_the_default_headers_are_extended_not_replaced(self) -> None:
        allowed = self.allowed_headers("authorization, content-type")

        self.assertLessEqual({"accept", "authorization", "content-type"}, allowed)
