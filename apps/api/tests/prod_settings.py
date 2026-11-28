"""Importing `config.settings.prod` in a test, with every setting production requires.

`prod.py` refuses to boot without some environment variables. A test that loads it to check
one of them must supply all the others, or it passes because a different one is missing.
`PROD_REQUIRED_ENV` is the one list: a new required production setting is added here.

Not a test module (no `test_` prefix), so the runner imports it only through the tests.
"""

from __future__ import annotations

import importlib
import sys
from types import ModuleType
from unittest import mock

from cryptography.fernet import Fernet

#: Every variable `prod.py` reads without a default, with a valid value.
PROD_REQUIRED_ENV: dict[str, str] = {
    "INTEGRATIONS_ENCRYPTION_KEYS": Fernet.generate_key().decode(),
    "API_PUBLIC_URL": "https://api.example.com",
    "WEBSITE_CNAME_TARGET": "sites.example.com",
    "NUM_PROXIES": "0",
    "REDIS_HOST": "redis.example.com",
    "REDIS_PORT": "6379",
    "REDIS_AUTH_TOKEN": "placeholder-not-a-secret",
}


def load_prod_settings(**overrides: str | None) -> ModuleType:
    """A fresh import of `config.settings.prod` under `PROD_REQUIRED_ENV` plus `overrides`.

    An override of `None` removes that variable. django-environ reads `Env.ENVIRON`; swapping
    it keeps the test off `os.environ`.
    """
    from config.settings import base

    environ = {**PROD_REQUIRED_ENV, **overrides}
    environ = {name: value for name, value in environ.items() if value is not None}
    with mock.patch.object(base.env, "ENVIRON", environ):
        sys.modules.pop("config.settings.prod", None)
        try:
            return importlib.import_module("config.settings.prod")
        finally:
            sys.modules.pop("config.settings.prod", None)
