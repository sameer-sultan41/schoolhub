"""A scripted provider for tests (``AI_PROVIDER = "fake"`` in config/settings/test.py).

A test queues what the next calls return or raise, and reads back the last call,
so it can assert on the exact prompt the gateway sent (what was redacted, what
was fenced) without any network.
"""

from __future__ import annotations

from dataclasses import dataclass

from core.ai.providers.base import ProviderResult, ProviderUnavailable


@dataclass(frozen=True)
class FakeCall:
    model: str
    system: str
    user: str
    max_output_tokens: int
    deadline: float


def ok_result(
    text: str = "",
    *,
    stop_reason: str = "end_turn",
    input_tokens: int = 100,
    output_tokens: int = 50,
    cache_creation_input_tokens: int = 0,
    cache_read_input_tokens: int = 0,
    model: str = "fake-model",
) -> ProviderResult:
    return ProviderResult(
        text=text,
        stop_reason=stop_reason,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_creation_input_tokens=cache_creation_input_tokens,
        cache_read_input_tokens=cache_read_input_tokens,
        model=model,
    )


class FakeProvider:
    name = "fake"

    def __init__(self) -> None:
        self.configured = True
        self.calls: list[FakeCall] = []
        self._script: list[ProviderResult | ProviderUnavailable] = []

    def reset(self) -> None:
        self.configured = True
        self.calls = []
        self._script = []

    def script(self, *outcomes: ProviderResult | ProviderUnavailable) -> None:
        """Queue what the next calls return (a result) or raise (``ProviderUnavailable``)."""
        self._script.extend(outcomes)

    @property
    def last_call(self) -> FakeCall | None:
        return self.calls[-1] if self.calls else None

    def is_configured(self) -> bool:
        return self.configured

    def complete(
        self,
        *,
        model: str,
        system: str,
        user: str,
        max_output_tokens: int,
        deadline: float,
    ) -> ProviderResult:
        self.calls.append(FakeCall(model, system, user, max_output_tokens, deadline))
        if not self._script:
            raise AssertionError("FakeProvider was called with nothing scripted")
        outcome = self._script.pop(0)
        if isinstance(outcome, ProviderUnavailable):
            raise outcome
        return outcome


#: The one instance ``get_provider`` returns under the fake setting.
fake_provider = FakeProvider()
