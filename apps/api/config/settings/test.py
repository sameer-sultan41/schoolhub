"""Test settings.

Tests run against PostgreSQL — never SQLite — because Row-Level Security is the
core isolation mechanism and cannot be exercised on another backend.
"""

from config.settings.base import *

DEBUG = False

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]  # speed only, tests

CELERY_TASK_ALWAYS_EAGER = True

CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"

INTEGRATIONS_ENCRYPTION_KEYS = ["dGVzdC1vbmx5LWludGVncmF0aW9ucy1rZXktMDAwMDA="]
PAYMENT_PROVIDERS_ENABLED = ["fake"]
API_PUBLIC_URL = "https://api.schoolhub.test"
