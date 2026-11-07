"""`run_feature`: gates in order, one audit row per call, refusals explicit and counted."""

from __future__ import annotations

import datetime
from unittest import mock

import anthropic
import httpx2
from django.conf import settings
from django.test import TestCase, override_settings

from apps.school_organization.tests.factories import TenantFactory, UserFactory
from core.ai import budget
from core.ai.exceptions import AIQuotaExceeded, AIUnavailable
from core.ai.features import GATEWAY_FLAG
from core.ai.grounding import GroundingContext
from core.ai.models import AIOutcome
from core.ai.providers.anthropic import AnthropicProvider
from core.ai.providers.base import ProviderUnavailable
from core.ai.providers.fake import fake_provider, ok_result
from core.ai.redaction import Pseudonymizer
from core.ai.service import output_ref, run_feature
from core.ai.tests.base import (
    PROBE_FLAG,
    PROBE_KEY,
    ensure_probe_feature,
    render_error,
    rows,
    set_budget,
    set_flag,
    spend,
)
from core.api.exceptions import ModuleDisabled
from core.tenancy.context import tenant_context

FACTS = GroundingContext(facts={"total": "1,000"}, allowed_labels=frozenset())


class GatewayTestCase(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.feature = ensure_probe_feature()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        set_flag(self.tenant, PROBE_FLAG, enabled=True)

    def run_probe(self, grounding: GroundingContext = FACTS, **kwargs):
        return run_feature(
            feature_key=PROBE_KEY,
            user=self.user,
            tenant=self.tenant,
            user_prompt="Summarise the facts.",
            input_ref="test:probe",
            grounding=grounding,
            **kwargs,
        )


class FlagAndConfigurationTests(GatewayTestCase):
    def test_gateway_kill_switch_override_refuses_and_records_disabled(self) -> None:
        set_flag(self.tenant, GATEWAY_FLAG, enabled=False)

        with self.assertRaises(ModuleDisabled) as raised:
            self.run_probe()

        response = render_error(raised.exception)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["error"]["code"], "module_disabled")
        self.assertEqual([r.outcome for r in rows(self.tenant)], [AIOutcome.DISABLED])
        self.assertEqual(fake_provider.calls, [])

    def test_feature_flag_off_is_403_module_disabled(self) -> None:
        set_flag(self.tenant, PROBE_FLAG, enabled=False)

        with self.assertRaises(ModuleDisabled) as raised:
            self.run_probe()

        self.assertEqual(render_error(raised.exception).data["error"]["code"], "module_disabled")
        self.assertEqual([r.outcome for r in rows(self.tenant)], [AIOutcome.DISABLED])
        self.assertEqual(fake_provider.calls, [])

    @override_settings(AI_PROVIDER="anthropic", ANTHROPIC_API_KEY="")
    def test_missing_api_key_is_503_ai_unavailable(self) -> None:
        with self.assertRaises(AIUnavailable) as raised:
            self.run_probe()

        response = render_error(raised.exception)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.data["error"]["code"], "ai_unavailable")
        (row,) = rows(self.tenant)
        self.assertEqual(row.outcome, AIOutcome.FALLBACK)
        self.assertEqual(row.model, "")


class BudgetTests(GatewayTestCase):
    def test_monthly_budget_refuses_with_429_ai_quota_exceeded(self) -> None:
        set_budget(self.tenant, 1000)
        spend(self.tenant, UserFactory(tenant=self.tenant).pk, 1000)

        with self.assertRaises(AIQuotaExceeded) as raised:
            self.run_probe()

        response = render_error(raised.exception)
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.data["error"]["code"], "ai_quota_exceeded")
        self.assertEqual(response.data["error"]["meta"], {"scope": "tenant"})
        self.assertEqual(rows(self.tenant)[-1].outcome, AIOutcome.QUOTA)
        self.assertEqual(fake_provider.calls, [])

    @override_settings(AI_USER_DAILY_TOKEN_CAP=100)
    def test_user_daily_cap_refuses_with_429(self) -> None:
        spend(self.tenant, self.user.pk, 100)

        with self.assertRaises(AIQuotaExceeded) as raised:
            self.run_probe()

        response = render_error(raised.exception)
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.data["error"]["meta"], {"scope": "user"})
        self.assertEqual(fake_provider.calls, [])

        # Another user of the same school still has their own day.
        self.user = UserFactory(tenant=self.tenant)
        fake_provider.script(ok_result("Total {{fact:total}}."))
        self.assertEqual(self.run_probe().text, "Total 1,000.")

    def test_budget_warning_at_80_percent(self) -> None:
        set_budget(self.tenant, 1000)
        fake_provider.script(ok_result("Total {{fact:total}}.", input_tokens=100, output_tokens=50))
        self.assertFalse(self.run_probe().budget_warning)  # 150 of 1000

        spend(self.tenant, self.user.pk, 500)  # 650 used
        fake_provider.script(ok_result("Total {{fact:total}}.", input_tokens=100, output_tokens=50))
        self.assertTrue(self.run_probe().budget_warning)  # 800 of 1000

    def test_budget_windows_use_tenant_timezone(self) -> None:
        karachi = TenantFactory(timezone="Asia/Karachi")  # UTC+5, no DST
        user = UserFactory(tenant=karachi)
        utc = datetime.UTC
        # 31 Oct 23:00 in Karachi: last month there.
        spend(karachi, user.pk, 7, at=datetime.datetime(2026, 10, 31, 18, 0, tzinfo=utc))
        # 1 Nov 01:00 in Karachi, though still 31 Oct in UTC: this month there.
        spend(karachi, user.pk, 11, at=datetime.datetime(2026, 10, 31, 20, 0, tzinfo=utc))
        # 15 Nov 23:30 in Karachi, 16 Nov 00:30 in Karachi.
        spend(karachi, user.pk, 13, at=datetime.datetime(2026, 11, 15, 18, 30, tzinfo=utc))
        spend(karachi, user.pk, 17, at=datetime.datetime(2026, 11, 15, 19, 30, tzinfo=utc))

        now = datetime.datetime(2026, 11, 15, 20, 0, tzinfo=utc)  # 16 Nov 01:00 in Karachi
        with tenant_context(karachi.id):
            self.assertEqual(budget.used_this_month(karachi, now=now), 11 + 13 + 17)
            self.assertEqual(budget.used_today(karachi, user.pk, now=now), 17)

    def test_cache_tokens_count_toward_budget(self) -> None:
        set_budget(self.tenant, 1000)
        fake_provider.script(
            ok_result(
                "Total {{fact:total}}.",
                input_tokens=10,
                output_tokens=20,
                cache_creation_input_tokens=300,
                cache_read_input_tokens=400,
            )
        )
        self.run_probe()

        with tenant_context(self.tenant.id):
            self.assertEqual(budget.used_this_month(self.tenant), 730)

        # Cache reads alone can spend the month.
        spend(self.tenant, self.user.pk, 0, cache_read=270)
        with self.assertRaises(AIQuotaExceeded):
            self.run_probe()

    def test_tenant_override_budget_wins(self) -> None:
        self.assertGreater(settings.AI_MONTHLY_TOKEN_BUDGET_DEFAULT, 600)
        set_budget(self.tenant, 500)
        spend(self.tenant, self.user.pk, 600)

        with self.assertRaises(AIQuotaExceeded):
            self.run_probe()

        # Another school, no override: the platform default applies.
        other = TenantFactory()
        set_flag(other, PROBE_FLAG, enabled=True)
        spend(other, UserFactory(tenant=other).pk, 600)
        self.tenant, self.user = other, UserFactory(tenant=other)
        fake_provider.script(ok_result("Total {{fact:total}}."))
        self.assertEqual(self.run_probe().text, "Total 1,000.")


class ProviderBehaviourTests(GatewayTestCase):
    def test_provider_error_degrades_with_503(self) -> None:
        fake_provider.script(ProviderUnavailable("boom", status_code=529))

        with self.assertRaises(AIUnavailable) as raised:
            self.run_probe()

        self.assertEqual(render_error(raised.exception).status_code, 503)
        (row,) = rows(self.tenant)
        self.assertEqual(row.outcome, AIOutcome.FALLBACK)
        self.assertEqual(row.input_tokens + row.output_tokens, 0)

    @override_settings(AI_PROVIDER="anthropic", ANTHROPIC_API_KEY="test-key")
    def test_provider_4xx_maps_to_503_and_logs_error(self) -> None:
        request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
        rejected = anthropic.AuthenticationError(
            "invalid x-api-key",
            response=httpx2.Response(401, request=request),
            body={"type": "error", "error": {"type": "authentication_error"}},
        )
        client = mock.Mock()
        client.messages.create.side_effect = rejected

        with (
            mock.patch.object(AnthropicProvider, "client", return_value=client),
            self.assertLogs("core.ai.providers.anthropic", level="ERROR") as logs,
            self.assertRaises(AIUnavailable) as raised,
        ):
            self.run_probe()

        self.assertEqual(render_error(raised.exception).data["error"]["code"], "ai_unavailable")
        self.assertEqual(client.messages.create.call_count, 1)  # a 4xx is never retried
        self.assertIn("rejected", logs.output[0])
        self.assertEqual(rows(self.tenant)[-1].outcome, AIOutcome.FALLBACK)

    def test_non_end_turn_stop_reason_is_refused(self) -> None:
        fake_provider.script(ok_result("Total {{fact:total}}", stop_reason="max_tokens"))

        with self.assertRaises(AIUnavailable):
            self.run_probe()

        (row,) = rows(self.tenant)
        self.assertEqual(row.outcome, AIOutcome.REFUSED)
        self.assertEqual((row.input_tokens, row.output_tokens), (100, 50))

    def test_validator_refusal_still_counts_tokens(self) -> None:
        fake_provider.script(ok_result("Collected 1,000 this month."))  # a bare number

        with self.assertRaises(AIUnavailable):
            self.run_probe()

        (row,) = rows(self.tenant)
        self.assertEqual(row.outcome, AIOutcome.REFUSED)
        self.assertEqual(row.output_ref, output_ref("Collected 1,000 this month."))
        with tenant_context(self.tenant.id):
            self.assertEqual(budget.used_this_month(self.tenant), 150)

    def test_ok_run_records_tokens_model_prompt_version_latency_output_ref(self) -> None:
        names = Pseudonymizer()
        cashier = names.alias("Cashier", "Ayesha Khan")
        raw = f"{cashier} collected {{{{fact:total}}}}."
        fake_provider.script(
            ok_result(
                raw,
                input_tokens=120,
                output_tokens=40,
                cache_creation_input_tokens=10,
                cache_read_input_tokens=5,
                model="claude-haiku-5-5",
            )
        )
        grounding = GroundingContext(facts={"total": "1,000"}, allowed_labels=names.aliases)

        run = self.run_probe(grounding=grounding, pseudonymizer=names)

        self.assertEqual(run.text, "Ayesha Khan collected 1,000.")
        self.assertEqual(run.prompt_version, "ai.test-probe@1")
        call = fake_provider.last_call
        assert call is not None
        self.assertEqual(call.model, settings.AI_MODEL_FAST)
        self.assertEqual(call.system, self.feature.system_prompt)
        self.assertEqual(call.max_output_tokens, self.feature.max_output_tokens)

        (row,) = rows(self.tenant)
        self.assertEqual(row.pk, run.request_id)
        self.assertEqual(row.outcome, AIOutcome.OK)
        self.assertEqual(row.user_id, self.user.pk)
        self.assertEqual(row.feature_key, PROBE_KEY)
        self.assertEqual(row.prompt_version, "ai.test-probe@1")
        self.assertEqual(row.model, "claude-haiku-5-5")
        self.assertEqual(row.input_ref, "test:probe")
        self.assertEqual(row.output_ref, output_ref(raw))
        self.assertNotIn("Ayesha", row.output_ref)
        self.assertEqual(
            (
                row.input_tokens,
                row.output_tokens,
                row.cache_creation_input_tokens,
                row.cache_read_input_tokens,
            ),
            (120, 40, 10, 5),
        )
        self.assertGreaterEqual(row.latency_ms, 0)
