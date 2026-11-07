"""``run_feature``: the one way an AI feature calls a model.

The transaction shape is the point of this module:

1. The gates run in one short ``tenant_atomic``: the kill switch, the feature's
   flag, the provider configuration, the tenant's monthly budget and the user's
   daily cap, in that order.
2. The provider is called with **no transaction open**, so a 30 s call never
   holds a database connection's transaction or a lock.
3. The ``ai_requests`` row is committed in its own ``tenant_atomic`` in a
   ``finally``, before any exception leaves this function. A refusal (403, 429,
   503) therefore still leaves exactly one committed row, even though DRF rolls
   back the request's transaction on an error response.

So the caller must not hold a transaction either: a view that calls this is
``transaction.non_atomic_requests``, or the audit row would be rolled back with
the error response it explains.
"""

from __future__ import annotations

import hashlib
import logging
import time
import uuid
from dataclasses import dataclass, field

from django.conf import settings

from core.ai import budget
from core.ai.exceptions import AIQuotaExceeded, AIUnavailable
from core.ai.features import GATEWAY_FLAG
from core.ai.grounding import GroundingContext, render
from core.ai.models import AIOutcome, AIRequest
from core.ai.providers import ProviderUnavailable, get_provider
from core.ai.redaction import Pseudonymizer
from core.ai.registry import AIFeature, Tier, registry
from core.api.exceptions import ModuleDisabled
from core.rbac.models import User
from core.tenancy.context import tenant_atomic
from core.tenancy.features import is_feature_enabled
from core.tenancy.models import Tenant

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AIRun:
    """A successful call. ``text`` is already validated, rendered and restored."""

    request_id: uuid.UUID
    text: str
    model: str
    prompt_version: str
    budget_warning: bool


@dataclass
class _Audit:
    """The row being assembled as the call proceeds; written once, at the end."""

    id: uuid.UUID
    outcome: str
    model: str = ""
    output_ref: str = ""
    tokens: dict[str, int] = field(default_factory=dict)


def model_for_tier(tier: Tier) -> str:
    model: str = settings.AI_MODEL_FAST if tier == "fast" else settings.AI_MODEL_STANDARD
    return model


def output_ref(text: str) -> str:
    """A reference to an output, never the output itself (ai-governance.md §1.6)."""
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


def run_feature(
    *,
    feature_key: str,
    user: User,
    tenant: Tenant,
    user_prompt: str,
    input_ref: str,
    grounding: GroundingContext,
    pseudonymizer: Pseudonymizer | None = None,
) -> AIRun:
    """Run one AI feature for ``user``. Raises ``ModuleDisabled`` (403),
    ``AIQuotaExceeded`` (429) or ``AIUnavailable`` (503); records exactly one row."""
    feature = registry.get(feature_key)
    started = time.monotonic()
    # Anything unexpected that escapes is recorded as the degraded path, not lost.
    audit = _Audit(id=uuid.uuid4(), outcome=AIOutcome.FALLBACK)
    try:
        return _run(feature, audit, user, tenant, user_prompt, grounding, pseudonymizer)
    finally:
        _record(
            audit,
            feature=feature,
            user=user,
            tenant=tenant,
            input_ref=input_ref,
            latency_ms=int((time.monotonic() - started) * 1000),
        )


def _run(
    feature: AIFeature,
    audit: _Audit,
    user: User,
    tenant: Tenant,
    user_prompt: str,
    grounding: GroundingContext,
    pseudonymizer: Pseudonymizer | None,
) -> AIRun:
    provider = get_provider()

    with tenant_atomic(tenant.pk):
        if not is_feature_enabled(GATEWAY_FLAG, tenant_id=tenant.pk) or not is_feature_enabled(
            feature.flag_key, tenant_id=tenant.pk
        ):
            audit.outcome = AIOutcome.DISABLED
            raise ModuleDisabled("AI is not enabled for your school.")
        if not provider.is_configured():
            logger.error("AI provider is not configured", extra={"provider": provider.name})
            audit.outcome = AIOutcome.FALLBACK
            raise AIUnavailable()
        limit = budget.monthly_limit(tenant)
        used_month = budget.used_this_month(tenant)
        if used_month >= limit:
            audit.outcome = AIOutcome.QUOTA
            raise AIQuotaExceeded("tenant")
        if budget.used_today(tenant, user.pk) >= budget.daily_user_cap():
            audit.outcome = AIOutcome.QUOTA
            raise AIQuotaExceeded("user")

    # No transaction from here: the call may take up to the full deadline.
    audit.model = model_for_tier(feature.tier)
    try:
        result = provider.complete(
            model=audit.model,
            system=feature.system_prompt,
            user=user_prompt,
            max_output_tokens=feature.max_output_tokens,
            deadline=time.monotonic() + settings.AI_REQUEST_DEADLINE_SECONDS,
        )
    except ProviderUnavailable as exc:
        audit.outcome = AIOutcome.FALLBACK
        raise AIUnavailable() from exc

    # Billed whatever happens next, so a refused answer still counts toward the budget.
    audit.model = result.model or audit.model
    audit.output_ref = output_ref(result.text)
    audit.tokens = {
        "input_tokens": result.input_tokens,
        "output_tokens": result.output_tokens,
        "cache_creation_input_tokens": result.cache_creation_input_tokens,
        "cache_read_input_tokens": result.cache_read_input_tokens,
    }

    if result.stop_reason != "end_turn":
        logger.warning(
            "AI output refused: stop reason",
            extra={"feature": feature.key, "stop_reason": result.stop_reason},
        )
        audit.outcome = AIOutcome.REFUSED
        raise AIUnavailable()

    verdict = feature.validate_output(result.text, grounding)
    if not verdict.ok:
        logger.warning(
            "AI output refused: validator",
            extra={"feature": feature.key, "reason": verdict.reason},
        )
        audit.outcome = AIOutcome.REFUSED
        raise AIUnavailable()

    text = render(result.text, grounding)
    if pseudonymizer is not None:
        text = pseudonymizer.restore(text)

    audit.outcome = AIOutcome.OK
    return AIRun(
        request_id=audit.id,
        text=text,
        model=audit.model,
        prompt_version=feature.prompt_version,
        budget_warning=budget.is_warning(used_month + result.total_tokens, limit),
    )


def _record(
    audit: _Audit,
    *,
    feature: AIFeature,
    user: User,
    tenant: Tenant,
    input_ref: str,
    latency_ms: int,
) -> None:
    with tenant_atomic(tenant.pk):
        AIRequest.objects.create(
            id=audit.id,
            tenant=tenant,
            user_id=user.pk,
            created_by=user.pk,
            feature_key=feature.key,
            prompt_version=feature.prompt_version,
            model=audit.model,
            input_ref=input_ref,
            output_ref=audit.output_ref,
            latency_ms=latency_ms,
            outcome=audit.outcome,
            **audit.tokens,
        )
