"""Grounded figures: the model names a fact, the server supplies its value.

A feature hands the model its numbers as named facts and tells it to write
``{{fact:<key>}}`` wherever it means one. ``check`` refuses any output that
names an unknown fact or carries a digit of its own outside the allowlisted
labels (``Cashier-2``, ``31-60 days``, a year in the period), so a figure the
model invented never reaches a reader (ai-governance.md §3.2). ``render`` then
substitutes the real values.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

PLACEHOLDER = re.compile(r"\{\{fact:([A-Za-z0-9_.-]+)\}\}")
_DIGIT = re.compile(r"\d")


@dataclass(frozen=True)
class GroundingContext:
    """The facts a feature's output may cite, and the labels it may quote verbatim."""

    facts: dict[str, str]
    allowed_labels: frozenset[str] = frozenset()


@dataclass(frozen=True)
class ValidationResult:
    ok: bool
    reason: str | None = None


def _label_pattern(labels: frozenset[str]) -> re.Pattern[str] | None:
    if not labels:
        return None
    # Longest first, and never inside a longer token: `Cashier-1` must not match
    # the front of `Cashier-12` and leave a bare `2` behind.
    alternatives = "|".join(re.escape(label) for label in sorted(labels, key=len, reverse=True))
    return re.compile(rf"(?<![\w-])(?:{alternatives})(?![\w-])")


def check(text: str, ctx: GroundingContext) -> ValidationResult:
    """Accept ``text`` only if every figure in it is a known placeholder or an allowed label."""
    unknown = sorted({key for key in PLACEHOLDER.findall(text) if key not in ctx.facts})
    if unknown:
        return ValidationResult(False, f"unknown fact placeholder: {', '.join(unknown)}")

    remainder = PLACEHOLDER.sub(" ", text)
    labels = _label_pattern(ctx.allowed_labels)
    if labels is not None:
        remainder = labels.sub(" ", remainder)
    if _DIGIT.search(remainder):
        return ValidationResult(False, "a number outside a fact placeholder")
    return ValidationResult(True)


def render(text: str, ctx: GroundingContext) -> str:
    """Substitute every ``{{fact:key}}``. Run ``check`` first; an unknown key raises."""

    def substitute(match: re.Match[str]) -> str:
        key = match.group(1)
        if key not in ctx.facts:
            raise KeyError(f"unknown fact placeholder {key!r}")
        return ctx.facts[key]

    return PLACEHOLDER.sub(substitute, text)
