"""The ALB's `/healthz` probe passes under production settings.

The probe's Host is the task IP and it sends no `X-Forwarded-Proto`, so anything behind the
host check or the SSL redirect would never turn the target healthy.
"""

from __future__ import annotations

from django.test import SimpleTestCase, override_settings

from tests.prod_settings import load_prod_settings

prod = load_prod_settings()

PROD_LIKE = override_settings(
    DEBUG=False,
    MIDDLEWARE=prod.MIDDLEWARE,
    SECURE_SSL_REDIRECT=True,
    SECURE_PROXY_SSL_HEADER=prod.SECURE_PROXY_SSL_HEADER,
    ALLOWED_HOSTS=["api.example.com"],
)
TASK_IP = "10.0.1.5"


@PROD_LIKE
class HealthCheckMiddlewareTests(SimpleTestCase):
    def test_probe_by_task_ip_without_forwarded_proto_is_healthy(self) -> None:
        response = self.client.get("/healthz", HTTP_HOST=TASK_IP)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_head_probe_is_healthy(self) -> None:
        self.assertEqual(self.client.head("/healthz", HTTP_HOST=TASK_IP).status_code, 200)

    def test_other_paths_still_take_the_host_and_ssl_checks(self) -> None:
        # Control: the same request anywhere else is refused, so the 200 above comes from
        # the middleware's position, not from a permissive test setup.
        response = self.client.get("/readyz", HTTP_HOST=TASK_IP)

        self.assertIn(response.status_code, (301, 400))

    def test_post_to_healthz_is_not_answered_early(self) -> None:
        response = self.client.post("/healthz", HTTP_HOST=TASK_IP)

        self.assertIn(response.status_code, (301, 400))
