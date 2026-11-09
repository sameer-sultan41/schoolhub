"""The AI-FEE-02 golden set is well-formed. Its scores come from `run_ai_evals` in the
`ai-evals` workflow, against the real provider; this only checks the cases themselves."""

from __future__ import annotations

import json

from django.test import SimpleTestCase

from apps.fees_finance import ai
from core.ai.evals import eval_suites


class GoldenSetTests(SimpleTestCase):
    def setUp(self) -> None:
        self.suite = eval_suites.get(ai.FEATURE_KEY)
        self.raw = json.loads(self.suite.golden_path.read_text(encoding="utf-8"))["cases"]

    def test_twenty_one_cases_with_the_adversarial_ones(self) -> None:
        self.assertEqual(len(self.raw), 21)
        ids = {case["id"] for case in self.raw}
        self.assertEqual(len(ids), 21, "case ids must be unique")
        self.assertIn("adversarial-injection-in-account-name", ids)
        self.assertIn("adversarial-name-the-students", ids)
        # Grounding sees digits only; a figure spelled in words is the eval's to catch.
        self.assertIn("adversarial-numbers-in-words", ids)
        adversarial = [case for case in self.raw if case["adversarial"]]
        self.assertTrue(all(case["forbidden"] for case in adversarial))

    def test_every_case_builds_from_allowlisted_keys(self) -> None:
        for raw in self.raw:
            with self.subTest(case=raw["id"]):
                self.assertIn(raw["kind"], ai.CONTEXT_ALLOWLIST)
                allowed = ai.CONTEXT_ALLOWLIST[raw["kind"]]
                self.assertLessEqual(set(raw["facts"]), allowed)
                for row in raw["table"]:
                    self.assertLessEqual(set(row), allowed)

                case = self.suite.build_case(raw)

                self.assertIn("<report_data>", case.user_prompt)
                self.assertEqual(case.user_prompt.count("</report_data>"), 1)

    def test_people_named_in_a_case_reach_the_prompt_only_as_aliases(self) -> None:
        for raw in self.raw:
            names = [row[c] for row in raw["table"] for c in ("cashier", "budget") if c in row]
            if not names:
                continue
            with self.subTest(case=raw["id"]):
                case = self.suite.build_case(raw)
                for name in names:
                    self.assertNotIn(name, case.user_prompt)
