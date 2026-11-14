"""The Anthropic adapter's retry: once, retryable failures only, inside the deadline.

The SDK client is mocked at `messages.create` and the adapter's clock is replaced,
so no test waits or reaches the network. The errors are the SDK's own classes.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest import mock

import anthropic
import httpx2
from django.test import SimpleTestCase, override_settings

from core.ai.providers import get_provider
from core.ai.providers.anthropic import AnthropicProvider
from core.ai.providers.base import ProviderUnavailable

REQUEST = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
DEADLINE_SECONDS = 30.0


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0
        self.sleeps: list[float] = []

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


def status_error(code: int, headers: dict[str, str] | None = None) -> anthropic.APIStatusError:
    response = httpx2.Response(code, headers=headers or {}, request=REQUEST)
    return anthropic.InternalServerError(f"status {code}", response=response, body=None)


class DeadlineTests(SimpleTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.clock = Clock()
        patcher = mock.patch(
            "core.ai.providers.anthropic.time",
            SimpleNamespace(monotonic=self.clock.monotonic, sleep=self.clock.sleep),
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        self.client = mock.Mock()
        self.provider = AnthropicProvider(api_key="test-key")
        self.provider._client = self.client

    def complete(self) -> None:
        self.provider.complete(
            model="claude-haiku-5-5",
            system="system",
            user="user",
            max_output_tokens=100,
            deadline=self.clock.now + DEADLINE_SECONDS,
        )

    def timeouts(self) -> list[float]:
        return [call.kwargs["timeout"] for call in self.client.messages.create.call_args_list]

    def test_deadline_bounds_total_retry_time(self) -> None:
        with self.subTest("a retryable failure is retried once, then gives up"):
            self.client.messages.create.side_effect = [status_error(500), status_error(500)]
            with self.assertRaises(ProviderUnavailable):
                self.complete()
            self.assertEqual(self.client.messages.create.call_count, 2)
            self.assertEqual(self.clock.sleeps, [0.5])
            self.assertTrue(all(t <= DEADLINE_SECONDS for t in self.timeouts()))

        with self.subTest("a retry-after beyond the deadline is not waited out"):
            self.client.reset_mock()
            self.clock.sleeps = []
            self.client.messages.create.side_effect = [
                status_error(529, {"retry-after": "120"}),
            ]
            with self.assertRaises(ProviderUnavailable):
                self.complete()
            self.assertEqual(self.client.messages.create.call_count, 1)
            self.assertEqual(self.clock.sleeps, [])

        with self.subTest("retry-after-ms is preferred to retry-after, as the SDK does"):
            self.client.reset_mock()
            self.clock.sleeps = []
            self.client.messages.create.side_effect = [
                status_error(529, {"retry-after-ms": "250", "retry-after": "120"}),
                status_error(529),
            ]
            with self.assertRaises(ProviderUnavailable):
                self.complete()
            self.assertEqual(self.client.messages.create.call_count, 2)
            self.assertEqual(self.clock.sleeps, [0.25])

        with self.subTest("a timeout that used up the deadline is not retried"):
            self.client.reset_mock()

            def slow_timeout(**kwargs: object) -> None:
                self.clock.now += 29.5
                raise anthropic.APITimeoutError(request=REQUEST)

            self.client.messages.create.side_effect = slow_timeout
            with self.assertRaises(ProviderUnavailable):
                self.complete()
            self.assertEqual(self.client.messages.create.call_count, 1)

    def test_a_retry_that_succeeds_returns_the_answer(self) -> None:
        message = anthropic.types.Message.model_construct(
            id="msg_1",
            type="message",
            role="assistant",
            model="claude-haiku-5-5",
            content=[anthropic.types.TextBlock.model_construct(type="text", text="Hello")],
            stop_reason="end_turn",
            usage=anthropic.types.Usage.model_construct(
                input_tokens=12,
                output_tokens=3,
                cache_creation_input_tokens=None,
                cache_read_input_tokens=4,
            ),
        )
        self.client.messages.create.side_effect = [
            anthropic.APIConnectionError(request=REQUEST),
            message,
        ]

        result = self.provider.complete(
            model="claude-haiku-5-5",
            system="system",
            user="user",
            max_output_tokens=100,
            deadline=self.clock.now + DEADLINE_SECONDS,
        )

        self.assertEqual(self.client.messages.create.call_count, 2)
        self.assertEqual(result.text, "Hello")
        self.assertEqual(result.stop_reason, "end_turn")
        self.assertEqual(result.model, "claude-haiku-5-5")
        self.assertEqual(
            (
                result.input_tokens,
                result.output_tokens,
                result.cache_creation_input_tokens,
                result.cache_read_input_tokens,
            ),
            (12, 3, 0, 4),
        )

    def test_the_client_never_retries_on_its_own(self) -> None:
        provider = AnthropicProvider(api_key="test-key")
        self.assertEqual(provider.client().max_retries, 0)

    def test_a_client_error_is_not_retried(self) -> None:
        rejected = anthropic.BadRequestError(
            "prompt is too long",
            response=httpx2.Response(400, request=REQUEST),
            body={"type": "error", "error": {"type": "invalid_request_error"}},
        )
        self.client.messages.create.side_effect = rejected

        with (
            self.assertLogs("core.ai.providers.anthropic", level="ERROR"),
            self.assertRaises(ProviderUnavailable) as raised,
        ):
            self.complete()

        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(self.client.messages.create.call_count, 1)


class ProviderCacheTests(SimpleTestCase):
    @override_settings(AI_PROVIDER="anthropic", ANTHROPIC_API_KEY="key-one")
    def test_one_provider_per_api_key(self) -> None:
        first = get_provider()

        self.assertIs(get_provider(), first)
        with override_settings(ANTHROPIC_API_KEY="key-two"):
            self.assertIsNot(get_provider(), first)
