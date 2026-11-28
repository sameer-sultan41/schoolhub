"""Production Redis URLs are TLS, token-authenticated and built from host, port and token.

`test_prod_settings.py`'s per-name loop already proves each of REDIS_HOST, REDIS_PORT and
REDIS_AUTH_TOKEN is required (they are in `PROD_REQUIRED_ENV`).
"""

from __future__ import annotations

from urllib.parse import unquote, urlsplit

from django.test import SimpleTestCase

from config.settings.base import redis_settings
from tests.prod_settings import PROD_REQUIRED_ENV, load_prod_settings


class RedisSettingsTests(SimpleTestCase):
    def test_redis_settings_quotes_token_and_requires_tls(self) -> None:
        token = "a/b@c:d"
        settings = redis_settings("h", 6379, token)
        urls = [
            settings["CACHES"]["default"]["LOCATION"],
            settings["CELERY_BROKER_URL"],
            settings["CELERY_RESULT_BACKEND"],
        ]
        for db, url in enumerate(urls):
            with self.subTest(db=db):
                parts = urlsplit(url)
                self.assertEqual(parts.scheme, "rediss")
                self.assertEqual(parts.hostname, "h")
                self.assertEqual(parts.port, 6379)
                self.assertEqual(unquote(parts.password or ""), token)
                self.assertEqual(parts.path, f"/{db}")
                self.assertEqual(parts.query, "ssl_cert_reqs=required")

    def test_prod_settings_build_tls_redis_urls(self) -> None:
        prod = load_prod_settings()
        host = PROD_REQUIRED_ENV["REDIS_HOST"]
        for url in (
            prod.CELERY_BROKER_URL,
            prod.CELERY_RESULT_BACKEND,
            prod.CACHES["default"]["LOCATION"],
        ):
            with self.subTest(url=url.split("@")[-1]):
                self.assertTrue(url.startswith("rediss://"))
                self.assertIn(host, url)
