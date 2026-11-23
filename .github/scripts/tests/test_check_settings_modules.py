"""Tests for .github/scripts/check_settings_modules.py, run by repo-hygiene.yml."""

from __future__ import annotations

import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / ".github" / "scripts"))
import check_settings_modules as checker  # its directory is put on sys.path just above


class SettingsModuleTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        (self.root / "apps/api/config/settings").mkdir(parents=True)
        (self.root / "apps/api/config/settings/prod.py").write_text("")
        self.env = self.root / "infra/terraform/envs/staging"
        self.env.mkdir(parents=True)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def run_main(self) -> int:
        with contextlib.redirect_stdout(io.StringIO()):
            return checker.main(["check", str(self.root)])

    def test_existing_module_passes(self) -> None:
        (self.env / "main.tf").write_text('DJANGO_SETTINGS_MODULE = "config.settings.prod"\n')
        self.assertEqual(self.run_main(), 0)

    def test_missing_module_fails(self) -> None:
        (self.env / "main.tf").write_text('\nDJANGO_SETTINGS_MODULE = "config.settings.staging"\n')
        self.assertEqual(
            checker.missing_modules(self.root),
            [(Path("infra/terraform/envs/staging/main.tf"), 2, "staging")],
        )
        self.assertEqual(self.run_main(), 1)

    def test_file_with_no_setting_passes(self) -> None:
        (self.env / "main.tf").write_text('locals { region = "us-east-1" }\n')
        self.assertEqual(self.run_main(), 0)


if __name__ == "__main__":
    unittest.main()
