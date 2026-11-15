"""Validation of theme-driven content (plan decisions 5, 5a and 6).

Section content is checked against the theme's constrained JSON Schema by
`Draft202012Validator`, given an explicit `FormatChecker` (jsonschema skips formats that have no
checker) and a `referencing.Registry` that resolves `$ref: rich_text.json`. File references are
derived from the schema (`x-widget: image`), never from property names.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from functools import cache
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry
from referencing.jsonschema import DRAFT202012

from apps.website_cms.constants import SAFE_URL_FORMAT
from apps.website_cms.themes import RICH_TEXT_SCHEMA_REF, load_rich_text_schema
from apps.website_cms.uploads import WEBSITE_MEDIA
from core.api.exceptions import DomainRuleViolation
from core.files.models import File, FileStatus

IMAGE_WIDGET = "image"
_FILE_NOT_AVAILABLE = "file_not_available: this file is not available."
_CONTROL_OR_SPACE = re.compile(r"[\x00-\x20\x7f]")


def is_safe_url(value: str) -> bool:
    """An absolute `https:` URL, or a `/`-relative path that is not protocol-relative.

    Rejects `javascript:`, `data:`, `http:`, `//host`, and the backslash form (`/\\host`) that
    browsers normalise to `//host`.
    """
    if not isinstance(value, str) or not value or _CONTROL_OR_SPACE.search(value):
        return False
    if value.startswith("/"):
        return not value.startswith(("//", "/\\"))
    if "\\" in value:
        return False
    parts = urlsplit(value)
    return parts.scheme == "https" and bool(parts.hostname)


@cache
def _format_checker() -> FormatChecker:
    # An empty checker: the only format a theme schema may name is `safe-url`.
    checker = FormatChecker(formats=())

    @checker.checks(SAFE_URL_FORMAT)
    def _safe_url(instance: object) -> bool:
        return is_safe_url(instance) if isinstance(instance, str) else True

    return checker


def format_checker() -> FormatChecker:
    return _format_checker()


@cache
def _registry() -> Registry:
    return Registry().with_resource(
        RICH_TEXT_SCHEMA_REF, DRAFT202012.create_resource(load_rich_text_schema())
    )


def _validator(schema: dict[str, Any]) -> Draft202012Validator:
    return Draft202012Validator(schema, registry=_registry(), format_checker=format_checker())


def _field_key(path: Iterable[object]) -> str:
    return ".".join(str(part) for part in path) or "non_field"


def _raise_schema_errors(validator: Draft202012Validator, instance: object) -> None:
    errors = sorted(
        validator.iter_errors(instance), key=lambda e: [str(part) for part in e.absolute_path]
    )
    if not errors:
        return
    details: dict[str, list[str]] = {}
    for error in errors:
        details.setdefault(_field_key(error.absolute_path), []).append(error.message)
    raise DomainRuleViolation(details)


def validate_section_content(theme: Any, section_type: str, content: dict[str, Any]) -> None:
    """Raise `DomainRuleViolation` for an unknown type or content the type's schema rejects.

    Errors are keyed by the JSON path inside `content` (`items.0.question`). Image values must
    also be UUID-shaped, so `assert_files_usable` never sees a free-form string.
    """
    entry = (theme.section_types or {}).get(section_type)
    if entry is None:
        raise DomainRuleViolation({"section_type": f"Unknown section type '{section_type}'."})
    schema = entry["schema"]
    _raise_schema_errors(_validator(schema), content)
    _assert_file_ids_shaped(schema, content)


def validate_theme_config(theme: Any, config: Any) -> None:
    """Raise `DomainRuleViolation`, keyed under `theme_config`, unless `config` fits the theme."""
    try:
        _raise_schema_errors(_validator(theme.config_schema or {}), config)
    except DomainRuleViolation as exc:
        raise DomainRuleViolation(prefix_details(exc, "theme_config")) from exc


def prefix_details(exc: DomainRuleViolation, prefix: str) -> dict[str, Any]:
    """`exc`'s field-keyed details with every key moved under `prefix` (`non_field` -> prefix)."""
    detail = exc.detail if isinstance(exc.detail, dict) else {"non_field": exc.detail}
    return {
        (prefix if key == "non_field" else f"{prefix}.{key}"): value
        for key, value in detail.items()
    }


def validate_rich_text(doc: dict[str, Any]) -> None:
    """Raise `DomainRuleViolation` unless `doc` is a valid block document."""
    schema = load_rich_text_schema()
    _raise_schema_errors(_validator(schema), doc)
    _assert_file_ids_shaped(schema, doc)


def _assert_file_ids_shaped(schema: dict[str, Any], content: Any) -> None:
    bad = {
        path: "Must be a file id."
        for path, parent, name in image_slots(schema, content)
        if parent[name] not in (None, "") and _as_uuid(parent[name]) is None
    }
    if bad:
        raise DomainRuleViolation(bad)


def _as_uuid(value: object) -> UUID | None:
    if isinstance(value, UUID):
        return value
    if not isinstance(value, str):
        return None
    try:
        return UUID(value)
    except ValueError:
        return None


def _resolve(schema: dict[str, Any], root: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Follow `$ref` (the rich-text document or a local `#/$defs/...`); returns (schema, root)."""
    ref = schema.get("$ref")
    if ref == RICH_TEXT_SCHEMA_REF:
        document = load_rich_text_schema()
        return document, document
    if isinstance(ref, str) and ref.startswith("#/"):
        node: Any = root
        for part in ref[2:].split("/"):
            node = node[part]
        return node, root
    return schema, root


def _walk(
    schema: dict[str, Any], value: Any, root: dict[str, Any], path: tuple[object, ...]
) -> Iterable[tuple[str, dict[str, Any], str]]:
    resolved, root = _resolve(schema, root)
    if resolved is not schema:
        yield from _walk(resolved, value, root, path)
        return
    for branch in schema.get("oneOf", ()):
        yield from _walk(branch, value, root, path)
    if isinstance(value, dict):
        for name, prop in schema.get("properties", {}).items():
            if name not in value:
                continue
            if prop.get("x-widget") == IMAGE_WIDGET:
                yield _field_key((*path, name)), value, name
            else:
                yield from _walk(prop, value[name], root, (*path, name))
    elif isinstance(value, list) and isinstance(schema.get("items"), dict):
        for index, item in enumerate(value):
            yield from _walk(schema["items"], item, root, (*path, index))


def image_slots(schema: dict[str, Any], content: Any) -> Iterable[tuple[str, dict[str, Any], str]]:
    """Yield `(json_path, parent_object, key)` for every `x-widget: image` property present."""
    return _walk(schema, content, schema, ())


def referenced_file_ids(schema: dict[str, Any], content: Any) -> set[UUID]:
    """Every file id at an `x-widget: image` property, through arrays and the rich-text `$ref`."""
    ids = (_as_uuid(parent[name]) for _, parent, name in image_slots(schema, content))
    return {file_id for file_id in ids if file_id is not None}


def assert_files_usable(ids: Iterable[UUID | str]) -> None:
    """Each id must be a ready `website.media` file visible to the current tenant, else 422.

    Visibility comes from RLS plus the tenant-scoped manager, so another tenant's file is
    indistinguishable from a missing one. A non-UUID is the same error, never a 500.
    """
    wanted: set[UUID] = set()
    for raw in ids:
        parsed = _as_uuid(raw)
        if parsed is None:
            raise DomainRuleViolation({"file_id": _FILE_NOT_AVAILABLE})
        wanted.add(parsed)
    if not wanted:
        return
    usable = set(
        File.objects.alive()
        .filter(id__in=wanted, purpose=WEBSITE_MEDIA.key, status=FileStatus.READY)
        .values_list("id", flat=True)
    )
    if wanted - usable:
        raise DomainRuleViolation({"file_id": _FILE_NOT_AVAILABLE})
