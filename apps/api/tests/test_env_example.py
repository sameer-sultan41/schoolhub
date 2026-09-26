"""`.env.example` lists exactly what the settings read (ADR-0014, repo-structure.md §4).

Drift here is silent and costly: the example once offered `S3_BUCKET`, `S3_ACCESS_KEY_ID` and
`S3_SECRET_ACCESS_KEY` while the settings read `S3_BUCKET_NAME` and `AWS_*`, so anyone copying
it got the defaults without noticing. This test reads both sides from source.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

from django.test import SimpleTestCase

API_ROOT = Path(__file__).resolve().parents[1]

# Listed in .env.example but deliberately not read through the settings modules.
NOT_READ_BY_SETTINGS = {
    # Selects the settings module itself; read by manage.py, wsgi.py, asgi.py and celery.py.
    "DJANGO_SETTINGS_MODULE",
    # For the planned core/ai gateway (apps/api/AGENTS.md rule 6); remove once it reads them.
    "ANTHROPIC_API_KEY",
    "AI_MONTHLY_TOKEN_BUDGET_DEFAULT",
}


def keys_read_by_settings() -> set[str]:
    """First-argument string literals of `env(...)` / `env.<cast>(...)` calls in config/settings."""
    keys: set[str] = set()
    for path in (API_ROOT / "config" / "settings").glob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if not isinstance(node, ast.Call) or not node.args:
                continue
            func = node.func
            is_env = (isinstance(func, ast.Name) and func.id == "env") or (
                isinstance(func, ast.Attribute)
                and isinstance(func.value, ast.Name)
                and func.value.id == "env"
            )
            first = node.args[0]
            if is_env and isinstance(first, ast.Constant) and isinstance(first.value, str):
                keys.add(first.value)
    return keys


def keys_in_example() -> set[str]:
    lines = (API_ROOT / ".env.example").read_text(encoding="utf-8").splitlines()
    return {m.group(1) for line in lines if (m := re.match(r"^([A-Z][A-Z0-9_]*)=", line))}


class EnvExampleTests(SimpleTestCase):
    def test_every_setting_read_from_the_environment_is_documented(self):
        missing = sorted(keys_read_by_settings() - keys_in_example())
        self.assertEqual(
            missing, [], "Add these to apps/api/.env.example with a dummy value and a comment."
        )

    def test_the_example_lists_nothing_the_settings_ignore(self):
        stale = sorted(keys_in_example() - keys_read_by_settings() - NOT_READ_BY_SETTINGS)
        self.assertEqual(
            stale, [], "apps/api/.env.example lists keys nothing reads — rename or remove them."
        )

    def test_the_allowlist_is_still_needed(self):
        overlap = sorted(NOT_READ_BY_SETTINGS & keys_read_by_settings())
        self.assertEqual(
            overlap, [], "The settings now read these — drop them from NOT_READ_BY_SETTINGS."
        )
