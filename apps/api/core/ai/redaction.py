"""Pseudonymization: a name leaves the backend only as a stable alias.

A feature's context builder swaps each identity for an alias (``Cashier-1``)
before the prompt is built, and the gateway swaps the aliases back in the
output once it has been validated (ai-governance.md §1.2). The map lives in
this object, for one request, and never leaves the backend.
"""

from __future__ import annotations

import re

_KIND = re.compile(r"^[A-Z][A-Za-z]*$")


class Pseudonymizer:
    def __init__(self) -> None:
        self._alias_by_value: dict[tuple[str, str], str] = {}
        self._value_by_alias: dict[str, str] = {}
        self._counts: dict[str, int] = {}

    def alias(self, kind: str, value: str) -> str:
        """The alias for ``value``: the same value of the same kind always gets the same one."""
        if not _KIND.match(kind):
            raise ValueError(f"Alias kind {kind!r} must be a capitalised word, e.g. 'Cashier'")
        existing = self._alias_by_value.get((kind, value))
        if existing is not None:
            return existing
        self._counts[kind] = self._counts.get(kind, 0) + 1
        alias = f"{kind}-{self._counts[kind]}"
        self._alias_by_value[(kind, value)] = alias
        self._value_by_alias[alias] = value
        return alias

    @property
    def aliases(self) -> frozenset[str]:
        """Every alias issued, for a grounding check's allowed labels."""
        return frozenset(self._value_by_alias)

    def restore(self, text: str) -> str:
        """Put the real values back. ``Cashier-1`` never matches inside ``Cashier-12``."""
        if not self._value_by_alias:
            return text
        alternatives = "|".join(
            re.escape(alias) for alias in sorted(self._value_by_alias, key=len, reverse=True)
        )
        pattern = re.compile(rf"(?<![\w-])(?:{alternatives})(?![\w-])")
        return pattern.sub(lambda match: self._value_by_alias[match.group(0)], text)
