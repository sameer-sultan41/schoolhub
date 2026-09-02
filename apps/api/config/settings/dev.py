"""Local development settings."""

import re

from config.settings.base import *  # noqa: F403
from config.settings.base import PLATFORM_DOMAIN, env

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

# Login/refresh use `credentials: "include"` (auth.ts) to carry the refresh cookie, and
# browsers reject a credentialed request against `Access-Control-Allow-Origin: *` — the
# origin must be echoed back exactly, which requires an explicit allowlist rather than
# CORS_ALLOW_ALL_ORIGINS, same as prod.py.
CORS_ALLOWED_ORIGINS = env.list(
    "CORS_ALLOWED_ORIGINS", default=["http://localhost:3000", "http://localhost:3001"]
)
# Tenant subdomains (dashboard: <slug>.PLATFORM_DOMAIN:3000, website: :3001) aren't
# enumerable up front, so they need a pattern rather than exact entries above.
CORS_ALLOWED_ORIGIN_REGEXES = [
    rf"^https?://([a-z0-9-]+\.)?{re.escape(PLATFORM_DOMAIN)}(:\d+)?$",
]
CORS_ALLOW_CREDENTIALS = True
