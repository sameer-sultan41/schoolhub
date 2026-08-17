"""Local development settings."""

from config.settings.base import *  # noqa: F403

DEBUG = True
ALLOWED_HOSTS = ["*"]

INSTALLED_APPS += ["drf_spectacular_sidecar"]  # noqa: F405

# Console email in development so nothing is sent to real guardians by accident.
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

CORS_ALLOW_ALL_ORIGINS = True
