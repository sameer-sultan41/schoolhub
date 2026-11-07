"""The Anthropic adapter: the only module on the platform that imports a provider SDK.

``core/ai/tests/test_boundaries.py`` fails the build if anything else does.
Nothing the SDK defines leaves this module: a response becomes a ``ProviderResult``
and every SDK error becomes ``ProviderUnavailable``.

Retries are ours, not the SDK's. The client is built with ``max_retries=0`` and
the adapter retries once, only for a retryable failure (a connection error or
timeout, 408, 409, 429, 5xx: the SDK's own retry policy) and only while the
deadline leaves time for it. A ``retry-after`` longer than what remains is not
waited out: the caller degrades instead (ADR-0035, ai-governance.md §7).
"""

from __future__ import annotations

import logging
import time

import anthropic

from core.ai.providers.base import ProviderResult, ProviderUnavailable

logger = logging.getLogger(__name__)

#: One retry, never more: the user is waiting on a synchronous request.
MAX_RETRIES = 1
#: The wait before the retry when the provider names none.
DEFAULT_RETRY_DELAY_SECONDS = 0.5
#: A retry that cannot get at least this long to run is not attempted.
MIN_ATTEMPT_SECONDS = 2.0
_RETRYABLE_STATUSES = frozenset({408, 409, 429})


def _is_retryable(status_code: int) -> bool:
    return status_code in _RETRYABLE_STATUSES or status_code >= 500


def _retry_delay(retry_after: str | None) -> float:
    if retry_after is None:
        return DEFAULT_RETRY_DELAY_SECONDS
    try:
        delay = float(retry_after)
    except ValueError:
        # An HTTP-date or garbage: treat it as unbounded, so no retry happens.
        return float("inf")
    return max(delay, 0.0)


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, *, api_key: str) -> None:
        self._api_key = api_key
        self._client: anthropic.Anthropic | None = None

    def is_configured(self) -> bool:
        return bool(self._api_key)

    def client(self) -> anthropic.Anthropic:
        if self._client is None:
            self._client = anthropic.Anthropic(api_key=self._api_key, max_retries=0)
        return self._client

    def complete(
        self,
        *,
        model: str,
        system: str,
        user: str,
        max_output_tokens: int,
        deadline: float,
    ) -> ProviderResult:
        if not self.is_configured():
            raise ProviderUnavailable("no API key is configured")

        retries = 0
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ProviderUnavailable("the deadline passed before a response")
            try:
                message = self.client().messages.create(
                    model=model,
                    max_tokens=max_output_tokens,
                    system=system,
                    messages=[{"role": "user", "content": user}],
                    timeout=remaining,
                )
            except anthropic.APIStatusError as exc:
                if not _is_retryable(exc.status_code):
                    # A bad key, an oversized or malformed request: retrying cannot help,
                    # and it is our bug or our configuration, so it is logged loudly.
                    logger.error(
                        "AI provider rejected the request",
                        extra={
                            "provider": self.name,
                            "status_code": exc.status_code,
                            "error_type": exc.type,
                            "provider_request_id": exc.request_id,
                        },
                    )
                    raise ProviderUnavailable(
                        f"provider returned {exc.status_code}", status_code=exc.status_code
                    ) from exc
                delay = _retry_delay(exc.response.headers.get("retry-after"))
                failure = ProviderUnavailable(
                    f"provider returned {exc.status_code}", status_code=exc.status_code
                )
                cause: Exception = exc
            except anthropic.APIConnectionError as exc:
                # Includes APITimeoutError.
                delay = DEFAULT_RETRY_DELAY_SECONDS
                failure = ProviderUnavailable("could not reach the provider")
                cause = exc
            except anthropic.APIError as exc:
                # Anything else the SDK raises, e.g. a response it could not parse.
                logger.error("AI provider call failed", extra={"provider": self.name})
                raise ProviderUnavailable("provider error") from exc
            else:
                return _to_result(message)

            retries += 1
            time_left = deadline - time.monotonic()
            if retries > MAX_RETRIES or delay + MIN_ATTEMPT_SECONDS > time_left:
                logger.warning(
                    "AI provider call failed; not retrying",
                    extra={"provider": self.name, "retries": retries - 1},
                )
                raise failure from cause
            time.sleep(delay)


def _to_result(message: anthropic.types.Message) -> ProviderResult:
    usage = message.usage
    return ProviderResult(
        text="".join(
            block.text for block in message.content if isinstance(block, anthropic.types.TextBlock)
        ),
        stop_reason=message.stop_reason or "",
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        cache_creation_input_tokens=usage.cache_creation_input_tokens or 0,
        cache_read_input_tokens=usage.cache_read_input_tokens or 0,
        model=str(message.model),
    )
