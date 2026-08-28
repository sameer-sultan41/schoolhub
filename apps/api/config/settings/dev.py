"""Local development settings."""

from config.settings.base import *  # noqa: F403

DEBUG = True
ALLOWED_HOSTS = ["*"]

INSTALLED_APPS += ["drf_spectacular_sidecar"]  # noqa: F405

# Serve Swagger UI assets from the sidecar package rather than a CDN.
SPECTACULAR_SETTINGS |= {  # noqa: F405
    "SWAGGER_UI_DIST": "SIDECAR",
    "SWAGGER_UI_FAVICON_HREF": "SIDECAR",
    "REDOC_DIST": "SIDECAR",
}

# Console email in development so nothing is sent to real guardians by accident.
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

CORS_ALLOW_ALL_ORIGINS = True
