"""Shared constants for the website module (decisions 5a, 6 and 14 of the plan)."""

import re

from django.db import models

#: Page slugs: lowercase segments joined by `/`, 120 characters at most.
PAGE_SLUG_PATTERN = r"^[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*$"
PAGE_SLUG_RE = re.compile(PAGE_SLUG_PATTERN)
PAGE_SLUG_MAX_LENGTH = 120

#: First slug segments the renderer owns as routes.
RESERVED_PAGE_SLUGS = frozenset(
    {
        "admin",
        "api",
        "verify",
        "news",
        "events",
        "gallery",
        "notices",
        "preview",
        "sitemap.xml",
        "robots.txt",
    }
)

#: Platform subdomain labels that never name a tenant's site. Mirrors the renderer's
#: `RESERVED_LABELS` (apps/website/src/lib/host.ts); keep the two in step.
RESERVED_SUBDOMAIN_LABELS = frozenset(
    {"www", "api", "app", "admin", "dashboard", "static", "cdn", "mail", "status"}
)

#: Custom domain columns (docs/05-database/entities/tenancy.md `custom_domains`).
DOMAIN_MAX_LENGTH = 253
DOMAIN_TOKEN_MAX_LENGTH = 64
DOMAIN_ERROR_MAX_LENGTH = 300
#: Longest domain input accepted before UTS #46 mapping: room for surrounding whitespace, a
#: trailing dot and characters the mapping removes, so huge input never reaches `idna`.
DOMAIN_INPUT_MAX_LENGTH = DOMAIN_MAX_LENGTH + 64

#: Custom domain lifecycle (module doc §20 "Custom domains").
MAX_CUSTOM_DOMAINS = 5
#: Consecutive failed daily re-checks before an active domain lapses to `failed`.
ACTIVE_RECHECK_FAILURE_LIMIT = 3
#: Each DNS query's whole lifetime, in seconds.
DNS_TIMEOUT_SECONDS = 3.0
#: The TXT record holding the verification token is `<prefix>.<domain>`.
DOMAIN_VERIFY_TXT_PREFIX = "_schoolhub-verify"
#: The beat retries a claim that is not active for this many hours after it was added.
DOMAIN_RETRY_WINDOW_HOURS = 72
#: `website.domain-failed` is sent once, when a claim is still failing after this many hours.
DOMAIN_FAILURE_NOTIFY_AFTER_HOURS = 24
#: The beat skips a `verifying` claim moved there this recently: a user's `:verify` owns it.
VERIFY_IN_FLIGHT_SECONDS = 60

#: The only `x-widget` hints a theme schema may carry.
SCHEMA_WIDGETS = frozenset({"text", "textarea", "image", "rich-text", "url"})

#: The only JSON Schema keywords a theme schema may use (decision 6), plus numeric/length
#: bounds for the renderer's `limit` and non-empty text props.
SCHEMA_KEYWORDS = frozenset(
    {
        "type",
        "properties",
        "required",
        "items",
        "enum",
        "maxLength",
        "minLength",
        "minimum",
        "maximum",
        "format",
        "$ref",
        "x-widget",
    }
)

#: The only `format` a theme schema may name; checked by a FormatChecker the validator is given.
SAFE_URL_FORMAT = "safe-url"


class SectionType(models.TextChoices):
    """Theme v1's section catalogue. Must equal `themes/default.json`'s `section_types` keys."""

    HERO = "hero", "Hero"
    ABOUT_SCHOOL = "about_school", "About the school"
    PRINCIPAL_MESSAGE = "principal_message", "Principal's message"
    DEPARTMENTS_GRID = "departments_grid", "Departments"
    TEACHERS_GRID = "teachers_grid", "Teachers"
    CLASSES_LIST = "classes_list", "Classes"
    ADMISSIONS_CTA = "admissions_cta", "Admissions call to action"
    EVENTS_LIST = "events_list", "Events"
    NEWS_LIST = "news_list", "News"
    NOTICE_BOARD = "notice_board", "Notice board"
    GALLERY = "gallery", "Gallery"
    CONTACT_FORM = "contact_form", "Contact form"
    RICH_TEXT = "rich_text", "Rich text"
    FAQ = "faq", "FAQ"


#: Upper bound on sections in one page, so a payload cannot grow without limit.
MAX_SECTIONS_PER_PAGE = 50

DEFAULT_THEME_CODE = "default"

#: Navigation menus: label length, items per menu (all levels) and nesting depth (top + one).
NAV_LABEL_MAX_LENGTH = 60
NAV_MAX_ITEMS = 50
NAV_MAX_DEPTH = 2


class NavTargetType(models.TextChoices):
    PAGE = "page", "Page"
    URL = "url", "External or relative URL"
    NEWS_INDEX = "news_index", "News listing"
    EVENTS_INDEX = "events_index", "Events listing"
    GALLERY_INDEX = "gallery_index", "Gallery listing"


#: News, event and album slugs: one lowercase segment, 120 characters at most (decision 14).
CONTENT_SLUG_PATTERN = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"
CONTENT_SLUG_RE = re.compile(CONTENT_SLUG_PATTERN)
CONTENT_SLUG_MAX_LENGTH = 120

#: Longest stored embed URL (the column is varchar(500)); the service answers 422 above it.
EMBED_URL_MAX_LENGTH = 500


def empty_rich_text() -> dict[str, list[dict[str, object]]]:
    """The empty block document, the default for news `body` and event `description`."""
    return {"blocks": []}


#: Hosts a gallery `video_embed` item may point at.
EMBED_HOSTS = frozenset(
    {"www.youtube.com", "youtube.com", "youtu.be", "player.vimeo.com", "vimeo.com"}
)

#: Contact form limits, declared once for the model columns and the service's checks.
CONTACT_NAME_MAX = 150
CONTACT_EMAIL_MAX = 254
CONTACT_PHONE_MAX = 30
CONTACT_PHONE_MIN = 7
CONTACT_SUBJECT_MAX = 200
CONTACT_MESSAGE_MAX = 5000
#: Digits, spaces and `+-()`, between 7 and 30 characters.
CONTACT_PHONE_RE = re.compile(rf"^[0-9 +\-()]{{{CONTACT_PHONE_MIN},{CONTACT_PHONE_MAX}}}$")
