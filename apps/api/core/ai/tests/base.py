"""Shared fixtures for the gateway's tests: a probe feature, flags, spend and the envelope."""

from __future__ import annotations

import datetime
import uuid

from django.utils import timezone
from rest_framework.response import Response
from rest_framework.test import APIRequestFactory

from core.ai import grounding
from core.ai.models import AIOutcome, AIRequest
from core.ai.providers.fake import fake_provider
from core.ai.registry import AIFeature, registry
from core.api.exceptions import envelope_exception_handler
from core.tenancy.context import tenant_context
from core.tenancy.models import FeatureFlag, Tenant, TenantFeatureOverride, TenantSettings

PROBE_KEY = "ai.test-probe"
PROBE_FLAG = "ai.test-probe"
PROBE_PROMPT = "You summarise. Write {{fact:<key>}} for every figure."

PROBE = AIFeature(
    key=PROBE_KEY,
    flag_key=PROBE_FLAG,
    tier="fast",
    prompt_version="ai.test-probe@1",
    system_prompt=PROBE_PROMPT,
    max_output_tokens=200,
    validate_output=grounding.check,
)


def ensure_probe_feature() -> AIFeature:
    """Register the probe once per process; the registry refuses a duplicate key."""
    if PROBE_KEY not in registry:
        registry.register(PROBE)
    # The probe's flag is not in the features registry, so a flush (TransactionTestCase)
    # does not recreate it; make sure the row exists, default off like a real feature.
    FeatureFlag.objects.get_or_create(
        key=PROBE_FLAG, defaults={"description": "Test probe", "default_enabled": False}
    )
    fake_provider.reset()
    return PROBE


def set_flag(tenant: Tenant, key: str, *, enabled: bool) -> None:
    flag = FeatureFlag.objects.get(key=key)
    with tenant_context(tenant.id):
        TenantFeatureOverride.objects.update_or_create(
            tenant=tenant,
            feature_flag=flag,
            defaults={"enabled": enabled, "reason": "core.ai test fixture"},
        )


def set_budget(tenant: Tenant, monthly_token_budget: int) -> None:
    with tenant_context(tenant.id):
        TenantSettings.objects.update_or_create(
            tenant=tenant, defaults={"ai": {"monthly_token_budget": monthly_token_budget}}
        )


def spend(
    tenant: Tenant,
    user_id: uuid.UUID,
    tokens: int,
    *,
    at: datetime.datetime | None = None,
    feature_key: str = PROBE_KEY,
    cache_read: int = 0,
) -> AIRequest:
    """An already-recorded call that used ``tokens`` input tokens (plus ``cache_read``)."""
    with tenant_context(tenant.id):
        return AIRequest.objects.create(
            tenant=tenant,
            user_id=user_id,
            feature_key=feature_key,
            prompt_version="ai.test-probe@1",
            model="fake-model",
            input_ref="test:spend",
            input_tokens=tokens,
            cache_read_input_tokens=cache_read,
            outcome=AIOutcome.OK,
            created_at=at or timezone.now(),
        )


def rows(tenant: Tenant) -> list[AIRequest]:
    with tenant_context(tenant.id):
        return list(AIRequest.objects.order_by("created_at"))


def render_error(exc: Exception) -> Response:
    """What the API would answer for ``exc``: the real envelope handler."""
    request = APIRequestFactory().post("/api/v1/anything")
    response = envelope_exception_handler(exc, {"request": request})
    assert response is not None
    return response
