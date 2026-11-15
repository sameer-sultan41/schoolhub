"""The pseudonymizer and the grounding check: pure functions, no database."""

from __future__ import annotations

from django.test import SimpleTestCase

from core.ai.grounding import GroundingContext, check, render
from core.ai.redaction import Pseudonymizer


class PseudonymizerTests(SimpleTestCase):
    def test_pseudonymizer_aliases_are_stable_and_restored(self) -> None:
        names = Pseudonymizer()
        first = names.alias("Cashier", "Ayesha Khan")
        second = names.alias("Cashier", "Bilal Ahmed")

        self.assertEqual(first, "Cashier-1")
        self.assertEqual(second, "Cashier-2")
        self.assertEqual(names.alias("Cashier", "Ayesha Khan"), first)
        self.assertEqual(names.aliases, frozenset({"Cashier-1", "Cashier-2"}))
        self.assertEqual(
            names.restore("Cashier-2 took more than Cashier-1."),
            "Bilal Ahmed took more than Ayesha Khan.",
        )

    def test_an_alias_never_restores_inside_a_longer_one(self) -> None:
        names = Pseudonymizer()
        for index in range(12):
            names.alias("Cashier", f"Person {index}")

        self.assertEqual(names.restore("Cashier-12 and Cashier-1"), "Person 11 and Person 0")

    def test_text_with_no_alias_is_unchanged(self) -> None:
        self.assertEqual(Pseudonymizer().restore("Nothing to restore."), "Nothing to restore.")

    def test_a_kind_must_be_a_word(self) -> None:
        with self.assertRaises(ValueError):
            Pseudonymizer().alias("cashier 1", "Ayesha Khan")


class GroundingTests(SimpleTestCase):
    def test_grounding_substitutes_placeholders(self) -> None:
        ctx = GroundingContext(facts={"collected": "PKR 1,250,000", "families": "312"})
        text = "{{fact:families}} families paid {{fact:collected}}."

        self.assertTrue(check(text, ctx).ok)
        self.assertEqual(render(text, ctx), "312 families paid PKR 1,250,000.")

    def test_grounding_refuses_bare_numbers_but_allows_labels(self) -> None:
        ctx = GroundingContext(
            facts={"overdue": "41"},
            allowed_labels=frozenset({"Cashier-1", "31-60 days", "2026"}),
        )

        with self.subTest("labels and placeholders pass"):
            text = "Cashier-1 holds most of the 31-60 days bucket in 2026: {{fact:overdue}}."
            self.assertTrue(check(text, ctx).ok)
        with self.subTest("an invented figure is refused"):
            verdict = check("About 40 families are overdue.", ctx)
            self.assertFalse(verdict.ok)
            self.assertEqual(verdict.reason, "a number outside a fact placeholder")
        with self.subTest("a label never shields a longer token"):
            self.assertFalse(check("Cashier-12 collected most.", ctx).ok)
        with self.subTest("an unknown fact is refused"):
            verdict = check("Total {{fact:made_up}}.", ctx)
            self.assertFalse(verdict.ok)
            self.assertIn("made_up", verdict.reason or "")

    def test_render_refuses_an_unknown_fact(self) -> None:
        with self.assertRaises(KeyError):
            render("{{fact:missing}}", GroundingContext(facts={}))
