#!/usr/bin/env python3
"""CI check: every Django settings module Terraform names exists.

    check_settings_modules.py [<repo-root>]

Reads every `infra/terraform/envs/*/main.tf`, extracts each `config.settings.<name>`, and fails
when `apps/api/config/settings/<name>.py` is missing. Terraform once named `production` and
`staging` modules that were never written, so neither environment could boot. This lives in
repo-hygiene (no path filter) so renaming a settings file also runs it.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

SETTING = re.compile(r"config\.settings\.([A-Za-z_][A-Za-z0-9_]*)")


def missing_modules(root: Path) -> list[tuple[Path, int, str]]:
    """Return (file, line, module) for every named settings module with no file."""
    settings_dir = root / "apps" / "api" / "config" / "settings"
    missing = []
    for tf in sorted((root / "infra" / "terraform" / "envs").glob("*/main.tf")):
        for lineno, line in enumerate(tf.read_text().splitlines(), start=1):
            for name in SETTING.findall(line):
                if not (settings_dir / f"{name}.py").is_file():
                    missing.append((tf.relative_to(root), lineno, name))
    return missing


def main(argv: list[str]) -> int:
    root = Path(argv[1]) if len(argv) > 1 else Path(".")
    missing = missing_modules(root)
    for path, lineno, name in missing:
        print(
            f"::error file={path},line={lineno}::config.settings.{name} has no "
            f"apps/api/config/settings/{name}.py"
        )
    if not missing:
        print("every settings module Terraform names exists")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
