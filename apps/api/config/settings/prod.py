"""Production settings.

Everything here is a hardening decision; see docs/06-security/security.md.
"""

from config.settings.base import *
from config.settings.base import env

DEBUG = False

# Required: no default, so the process fails at boot rather than at the first encrypt.
INTEGRATIONS_ENCRYPTION_KEYS = env.list("INTEGRATIONS_ENCRYPTION_KEYS")
# Required for the same reason: a callback URL pointing nowhere loses payments silently.
API_PUBLIC_URL = env("API_PUBLIC_URL")

SECURE_SSL_REDIRECT = True
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"

SESSION_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SECURE = True
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])

CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=[])
CORS_ALLOW_CREDENTIALS = True

X_FRAME_OPTIONS = "DENY"

# Connection reuse; PgBouncer fronts the database in transaction pooling mode.
DATABASES["default"]["CONN_MAX_AGE"] = env.int("DB_CONN_MAX_AGE", default=0)
