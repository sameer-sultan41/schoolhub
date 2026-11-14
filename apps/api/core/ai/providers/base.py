"""The provider interface. No SDK type crosses it (ai-governance.md §4)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class ProviderResult:
    text: str
    stop_reason: str
    input_tokens: int
    output_tokens: int
    cache_creation_input_tokens: int
    cache_read_input_tokens: int
    model: str

    @property
    def total_tokens(self) -> int:
        """Every token the call is billed for, cache writes and reads included."""
        return (
            self.input_tokens
            + self.output_tokens
            + self.cache_creation_input_tokens
            + self.cache_read_input_tokens
        )


class ProviderUnavailable(Exception):
    """The provider gave no usable answer: an error, a timeout, or no time left."""

    def __init__(self, reason: str, *, status_code: int | None = None) -> None:
        super().__init__(reason)
        self.reason = reason
        self.status_code = status_code


class Provider(Protocol):
    name: str

    def is_configured(self) -> bool:
        """False when the provider cannot be called at all (no API key)."""
        ...

    def complete(
        self,
        *,
        model: str,
        system: str,
        user: str,
        max_output_tokens: int,
        deadline: float,
    ) -> ProviderResult:
        """One completion. ``deadline`` is a ``time.monotonic()`` value the whole call,
        retries included, must finish by. Raises ``ProviderUnavailable``."""
        ...
