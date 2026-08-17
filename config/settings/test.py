"""Test settings.

Tests run against PostgreSQL — never SQLite — because Row-Level Security is the
core isolation mechanism and cannot be exercised on another backend.
"""

from config.settings.base import *  # noqa: F403

DEBUG = False

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]  # speed only, tests

CELERY_TASK_ALWAYS_EAGER = True

CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
