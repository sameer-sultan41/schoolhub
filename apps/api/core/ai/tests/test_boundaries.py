"""The provider SDK is imported in exactly one place (ai-governance.md §4, AGENTS.md rule 6).

Read from source rather than trusted to review: a second importer would let SDK
types, retries and errors leak past the adapter, and nothing else would notice.
"""

from __future__ import annotations

import ast

from django.test import SimpleTestCase

from tests.source_tree import source_modules

PROVIDER_SDKS = ("anthropic",)
ADAPTER = "core.ai.providers.anthropic"


def _imports_sdk(tree: ast.Module) -> bool:
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names = [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            names = [node.module]
        else:
            continue
        if any(name.split(".")[0] in PROVIDER_SDKS for name in names):
            return True
    return False


class SdkBoundaryTests(SimpleTestCase):
    def test_anthropic_imported_only_in_adapter(self) -> None:
        importers = sorted(module.name for module in source_modules() if _imports_sdk(module.tree))
        self.assertEqual(importers, [ADAPTER])
