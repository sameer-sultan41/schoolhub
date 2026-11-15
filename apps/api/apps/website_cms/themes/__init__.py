"""The code-declared theme registry and its `post_migrate` sync.

Themes are code: each `themes/<code>.json` declares a theme and its section catalogue, and
`sync_themes()` upserts them into the platform-scope `themes` table after every migrate, so a
theme edit needs no data migration (module doc §5.10). This mirrors
`core.tenancy.features.sync_feature_flags` (plan decision 6).

A theme file holds `{code, name, version, description, config_schema, section_types}`, where
`section_types` maps each section type to `{label, schema}`; `schema` uses only the JSON Schema
subset in `constants.SCHEMA_KEYWORDS`.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

THEMES_DIR = Path(__file__).resolve().parent
SCHEMAS_DIR = THEMES_DIR.parent / "schemas"

#: The `$ref` target section schemas use for a rich-text document.
RICH_TEXT_SCHEMA_REF = "rich_text.json"


def load_code_themes() -> dict[str, dict[str, Any]]:
    """Every theme declared in code, keyed by `code`."""
    themes: dict[str, dict[str, Any]] = {}
    for path in sorted(THEMES_DIR.glob("*.json")):
        theme = json.loads(path.read_text(encoding="utf-8"))
        themes[theme["code"]] = theme
    return themes


def load_rich_text_schema() -> dict[str, Any]:
    return json.loads((SCHEMAS_DIR / RICH_TEXT_SCHEMA_REF).read_text(encoding="utf-8"))


def sync_themes() -> dict[str, int]:
    """Upsert every code-declared theme into `themes`; returns created/updated/stale counts.

    A theme whose row exists but is no longer declared is left alone and logged, because a
    tenant's `website_settings` may still reference it.
    """
    from apps.website_cms.models import Theme

    declared = load_code_themes()
    existing = {theme.code: theme for theme in Theme.objects.all()}
    created = updated = 0
    for code, spec in declared.items():
        fields = {
            "name": spec["name"],
            "version": spec["version"],
            "description": spec.get("description", ""),
            "section_types": spec["section_types"],
            "config_schema": spec.get("config_schema", {}),
        }
        row = existing.get(code)
        if row is None:
            Theme.objects.create(code=code, is_active=True, **fields)
            created += 1
            continue
        changed = [name for name, value in fields.items() if getattr(row, name) != value]
        if changed:
            for name in changed:
                setattr(row, name, fields[name])
            row.save(update_fields=[*changed, "updated_at"])
            updated += 1

    stale = sorted(set(existing) - set(declared))
    if stale:
        logger.warning(
            "themes present in the database but no longer declared in code: %s", ", ".join(stale)
        )
    return {"created": created, "updated": updated, "stale": len(stale)}


def sync_themes_on_migrate(sender, **kwargs) -> None:
    """``post_migrate`` receiver, bound to this app in ``apps.py::ready()``."""
    sync_themes()
