"""Base settings shared by all environments.

Conventions come from the specification repo (docs/):
docs/02-architecture/tech-stack.md, api-architecture.md, multi-tenancy.md.
"""

from datetime import timedelta
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env()
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env("DJANGO_SECRET_KEY", default="insecure-dev-key-override-in-env")
DEBUG = env.bool("DJANGO_DEBUG", default=False)
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

# Apex domain for tenant wildcard subdomains: `<slug>.<PLATFORM_DOMAIN>`. Mirrors
# apps/website's NEXT_PUBLIC_PLATFORM_DOMAIN — same concept, backend side.
PLATFORM_DOMAIN = env("PLATFORM_DOMAIN", default="localhost")

# Object storage (core.files) — matches infra/compose's MinIO service in dev, real S3 in
# prod. Empty S3_ENDPOINT_URL selects NullPresigner (core.files.storage.get_presigner),
# which is what test/CI runs on since neither talks to a real object store.
S3_ENDPOINT_URL = env("S3_ENDPOINT_URL", default="")
S3_BUCKET_NAME = env("S3_BUCKET_NAME", default="schoolhub-dev")
S3_REGION_NAME = env("S3_REGION_NAME", default="us-east-1")
AWS_ACCESS_KEY_ID = env("AWS_ACCESS_KEY_ID", default="")
AWS_SECRET_ACCESS_KEY = env("AWS_SECRET_ACCESS_KEY", default="")

# Server-side type/size whitelist per purpose (student-management.md §11: "type/size
# whitelist, AV scan"). Sizes in bytes.
FILE_UPLOAD_RULES = {
    "student.photo": {
        "mime_types": {"image/jpeg", "image/png"},
        "max_size_bytes": 5 * 1024 * 1024,
    },
    "student.document": {
        "mime_types": {"image/jpeg", "image/png", "application/pdf"},
        "max_size_bytes": 10 * 1024 * 1024,
    },
    "guardian.photo": {
        "mime_types": {"image/jpeg", "image/png"},
        "max_size_bytes": 5 * 1024 * 1024,
    },
}

DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
]

THIRD_PARTY_APPS = [
    "rest_framework",
    "rest_framework_simplejwt",
    # Enables refresh-token revocation, which rotation depends on for theft detection.
    "rest_framework_simplejwt.token_blacklist",
    "django_filters",
    "corsheaders",
    "drf_spectacular",
]

# Platform foundation. Order matters: tenancy and rbac are imported by every module app.
CORE_APPS = [
    "core.tenancy",
    "core.rbac",
    "core.audit",
    "core.files",
    "core.idempotency",
]

# One app per module doc in docs/03-modules/.
MODULE_APPS = [
    "apps.school_organization",
    "apps.student_management",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + CORE_APPS + MODULE_APPS

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    # Assigns X-Request-ID and binds it to logs.
    "core.api.middleware.RequestIDMiddleware",
    # Resolves the tenant from the authenticated principal and sets app.tenant_id
    # for the transaction, which is what the RLS policies read.
    "core.tenancy.middleware.TenantMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DATABASES = {
    "default": env.db(
        "DATABASE_URL",
        default="postgres://schoolhub:schoolhub@localhost:5432/schoolhub",
    ),
}
# RLS requires SET LOCAL inside a transaction; see docs/02-architecture/database-architecture.md.
DATABASES["default"]["ATOMIC_REQUESTS"] = True

AUTH_USER_MODEL = "rbac.User"

# Students often log in with a school-issued username rather than an email.
#
# ModelBackend is deliberately NOT also listed here. IdentifierBackend already extends
# it and inherits everything else it provides (get_user, permission checks) — adding
# bare ModelBackend as a second backend would only add back its authenticate(), which
# looks a user up by email alone with no tenant_slug awareness at all. Django tries
# backends in order and accepts the first non-None result, so whenever IdentifierBackend
# correctly rejects a cross-tenant login attempt (empty candidate set), a plain
# ModelBackend entry would silently authenticate the same user anyway — defeating the
# multi-tenancy check IdentifierBackend exists for. Confirmed by reproducing exactly
# that: logging into another school's subdomain with a valid identifier/password from a
# *different* tenant succeeded before this backend was removed.
AUTHENTICATION_BACKENDS = [
    "core.rbac.backends.IdentifierBackend",
]

# auth.W004 warns that USERNAME_FIELD is not unique and asks that the backend be
# able to handle non-unique usernames. That is deliberate here: an email is unique
# per tenant (enforced by a partial unique constraint), because the same parent may
# hold accounts at two schools. IdentifierBackend handles the multiplicity — it
# verifies the password against every candidate and asks which school only when
# more than one matches.
SILENCED_SYSTEM_CHECKS = ["auth.W004"]

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 10},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_RENDERER_CLASSES": ("core.api.renderers.EnvelopeJSONRenderer",),
    "DEFAULT_PAGINATION_CLASS": "core.api.pagination.CursorPagination",
    "PAGE_SIZE": 25,
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.OrderingFilter",
        "rest_framework.filters.SearchFilter",
    ),
    "EXCEPTION_HANDLER": "core.api.exceptions.envelope_exception_handler",
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_THROTTLE_CLASSES": (
        "core.api.throttling.TenantRateThrottle",
        "core.api.throttling.UserRateThrottle",
    ),
    "DEFAULT_THROTTLE_RATES": {"tenant": "600/min", "user": "60/min", "anon": "20/min"},
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=30),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "sub",
}

SPECTACULAR_SETTINGS = {
    "TITLE": "SchoolHub API",
    "DESCRIPTION": "Multi-tenant School Management SaaS — see the specification in docs/.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "SCHEMA_PATH_PREFIX": "/api/v1",
}

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": env("REDIS_URL", default="redis://localhost:6379/0"),
    },
}

CELERY_BROKER_URL = env("CELERY_BROKER_URL", default="redis://localhost:6379/1")
CELERY_RESULT_BACKEND = env("CELERY_RESULT_BACKEND", default="redis://localhost:6379/2")
CELERY_TASK_ROUTES = {
    # Priority lanes per docs/02-architecture/notifications.md.
    "core.notifications.tasks.send_emergency*": {"queue": "emergency"},
    "core.notifications.tasks.send_transactional*": {"queue": "transactional"},
    "core.notifications.tasks.send_bulk*": {"queue": "bulk"},
}

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {"()": "core.api.logging.JSONFormatter"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "json"},
    },
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", default="INFO")},
}
