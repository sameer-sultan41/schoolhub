"""`config.settings.prod` refuses to boot without each setting production requires."""

from __future__ import annotations

from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase

from tests.prod_settings import PROD_REQUIRED_ENV, load_prod_settings


class ProductionRequiredSettingsTests(SimpleTestCase):
    def test_the_shared_environment_boots(self) -> None:
        prod = load_prod_settings()
        self.assertEqual(prod.WEBSITE_CNAME_TARGET, PROD_REQUIRED_ENV["WEBSITE_CNAME_TARGET"])

    def test_each_required_variable_is_required(self) -> None:
        # Every other variable is present, so the refusal can only come from this one.
        for name in PROD_REQUIRED_ENV:
            with self.subTest(missing=name), self.assertRaises(ImproperlyConfigured):
                load_prod_settings(**{name: None})

    def test_an_empty_cname_target_is_refused(self) -> None:
        with self.assertRaises(ImproperlyConfigured):
            load_prod_settings(WEBSITE_CNAME_TARGET="")
