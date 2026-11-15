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
