"""Navigation menus: validation of the item tree and the first-write upsert (module doc §11)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from django.db import IntegrityError, transaction

from apps.website_cms.constants import (
    NAV_LABEL_MAX_LENGTH,
    NAV_MAX_DEPTH,
    NAV_MAX_ITEMS,
    NavTargetType,
)
from apps.website_cms.errors import violation
from apps.website_cms.models import ContentStatus, MenuLocation, NavigationMenu, WebsitePage
from apps.website_cms.revalidation import queue_revalidation
from apps.website_cms.validation import is_safe_url
from core.api.exceptions import DomainRuleViolation
from core.tenancy.models import Tenant

_URL_MESSAGE = "must be an https URL or a relative path."


def list_menus() -> list[NavigationMenu]:
    """All three locations in a stable order; rows that do not exist yet are unsaved and empty."""
    rows = {menu.location: menu for menu in NavigationMenu.objects.alive()}
    return [rows.get(loc) or NavigationMenu(location=loc, items=[]) for loc in MenuLocation.values]


def _count(items: list[dict[str, Any]]) -> int:
    return sum(1 + _count(item.get("children") or []) for item in items)


def _as_uuid(value: object) -> UUID | None:
    try:
        return UUID(str(value))
    except ValueError:
        return None


def _check_item(item: dict[str, Any], path: str, depth: int, errors: dict[str, str]) -> None:
    label = item.get("label")
    if not isinstance(label, str) or not 1 <= len(label.strip()) <= NAV_LABEL_MAX_LENGTH:
        errors[f"{path}.label"] = f"invalid_label: 1 to {NAV_LABEL_MAX_LENGTH} characters."
    target_type = item.get("target_type")
    target = item.get("target")
    if target_type == NavTargetType.URL:
        if not isinstance(target, str) or not is_safe_url(target):
            errors[f"{path}.target"] = f"invalid_target: {_URL_MESSAGE}"
    elif target_type == NavTargetType.PAGE:
        if _as_uuid(target) is None:
            errors[f"{path}.target"] = "invalid_target: choose a published page."
    elif target:
        errors[f"{path}.target"] = "invalid_target: this link type takes no target."
    children = item.get("children") or []
    if children and depth >= NAV_MAX_DEPTH:
        errors[f"{path}.children"] = f"depth_exceeded: menus nest {NAV_MAX_DEPTH} levels at most."
        return
    for index, child in enumerate(children):
        _check_item(child, f"{path}.children.{index}", depth + 1, errors)


def _page_targets(items: list[dict[str, Any]], path: str, found: dict[UUID, list[str]]) -> None:
    for index, item in enumerate(items):
        where = f"{path}.{index}"
        if item.get("target_type") == NavTargetType.PAGE and (pid := _as_uuid(item.get("target"))):
            found.setdefault(pid, []).append(f"{where}.target")
        _page_targets(item.get("children") or [], f"{where}.children", found)


def _normalise(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for item in items:
        row: dict[str, Any] = {
            "label": item["label"].strip(),
            "target_type": item["target_type"],
            "children": _normalise(item.get("children") or []),
        }
        if item["target_type"] == NavTargetType.PAGE:
            # Canonical form, so the page-in-use guard's `str(page.id)` comparison matches.
            row["target"] = str(UUID(str(item["target"])))
        elif item["target_type"] == NavTargetType.URL:
            row["target"] = str(item["target"])
        out.append(row)
    return out


def validate_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return the tree in stored shape, or raise a 422 keyed by item path."""
    if _count(items) > NAV_MAX_ITEMS:
        raise violation("items", "too_many_items", f"at most {NAV_MAX_ITEMS} items per menu.")
    errors: dict[str, str] = {}
    for index, item in enumerate(items):
        _check_item(item, f"items.{index}", 1, errors)
    if not errors:
        wanted: dict[UUID, list[str]] = {}
        _page_targets(items, "items", wanted)
        live = set(
            WebsitePage.objects.alive()
            .filter(id__in=wanted, status=ContentStatus.PUBLISHED)
            .values_list("id", flat=True)
        )
        for page_id, paths in wanted.items():
            if page_id not in live:
                for path in paths:
                    errors[path] = "invalid_target: choose a published page."
    if errors:
        raise DomainRuleViolation(errors, meta={"reason": "invalid_target"})
    return _normalise(items)


def _locked_menu(tenant: Tenant, location: str, actor_id: UUID | None) -> NavigationMenu:
    """The location's row, locked; created on first write (race loser re-reads)."""
    query = NavigationMenu.objects.alive().select_for_update().filter(location=location)
    if (menu := query.first()) is not None:
        return menu
    try:
        with transaction.atomic():
            return NavigationMenu.objects.create(
                tenant=tenant, location=location, items=[], created_by=actor_id, updated_by=actor_id
            )
    except IntegrityError:
        return query.get()


def update_menu(
    tenant: Tenant, location: str, items: list[dict[str, Any]], actor_id: UUID | None
) -> tuple[NavigationMenu, list[dict[str, Any]], bool]:
    """Replace a menu's tree; returns the row, the previous items and whether anything changed."""
    stored = validate_items(items)
    with transaction.atomic():
        menu = _locked_menu(tenant, location, actor_id)
        before = menu.items
        changed = before != stored
        if changed:
            menu.items = stored
            menu.updated_by = actor_id
            menu.save(update_fields=["items", "updated_by", "updated_at"])
            queue_revalidation(tenant.pk)
    return menu, before, changed
