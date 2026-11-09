"""Token budgets (ai-governance.md §5, SEC-16).

A sum over ``ai_requests``, not a counter: the audit rows are already the meter,
so the two can never disagree. Every billed token counts, cache writes and reads
included. Windows are the tenant's own calendar month and day, in
``Tenant.timezone``, not the server's UTC.

The check runs before a call and the row is written after it, so concurrent calls
can overshoot by at most concurrency x (context + ``max_output_tokens``), which
``AIRequestThrottle`` bounds (ADR-0035). A Redis reservation is deferred until
real concurrency asks for it.
"""

from __future__ import annotations

import datetime
import uuid
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db.models import F, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone

from core.ai.models import AIRequest
from core.tenancy.models import Tenant, TenantSettings

#: The share of the monthly budget at which callers are warned (governance §5).
WARNING_THRESHOLD = 0.8

#: Every token a request is billed for; the budget and `GET /ai/usage` both sum it.
TOTAL_TOKENS = (
    F("input_tokens")
    + F("output_tokens")
    + F("cache_creation_input_tokens")
    + F("cache_read_input_tokens")
)


def _local_now(tenant: Tenant, now: datetime.datetime | None) -> datetime.datetime:
    return (now or timezone.now()).astimezone(ZoneInfo(tenant.timezone))


def month_start(tenant: Tenant, *, now: datetime.datetime | None = None) -> datetime.datetime:
    """Midnight on the first of this month, in the tenant's timezone."""
    return _local_now(tenant, now).replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def day_start(tenant: Tenant, *, now: datetime.datetime | None = None) -> datetime.datetime:
    """Midnight today, in the tenant's timezone."""
    return _local_now(tenant, now).replace(hour=0, minute=0, second=0, microsecond=0)


def monthly_limit(tenant: Tenant) -> int:
    """``TenantSettings.ai["monthly_token_budget"]`` when set, else the platform default."""
    row = TenantSettings.objects.filter(tenant_id=tenant.pk).only("ai").first()
    ai = row.ai if row is not None and isinstance(row.ai, dict) else {}
    value = ai.get("monthly_token_budget")
    if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
        return value
    default: int = settings.AI_MONTHLY_TOKEN_BUDGET_DEFAULT
    return default


def daily_user_cap() -> int:
    cap: int = settings.AI_USER_DAILY_TOKEN_CAP
    return cap


def _sum_since(since: datetime.datetime, **filters: object) -> int:
    total = AIRequest.objects.filter(created_at__gte=since, **filters).aggregate(
        total=Coalesce(Sum(TOTAL_TOKENS), 0)
    )["total"]
    return int(total)


def used_this_month(tenant: Tenant, *, now: datetime.datetime | None = None) -> int:
    return _sum_since(month_start(tenant, now=now), tenant_id=tenant.pk)


def used_today(tenant: Tenant, user_id: uuid.UUID, *, now: datetime.datetime | None = None) -> int:
    return _sum_since(day_start(tenant, now=now), tenant_id=tenant.pk, user_id=user_id)


def is_warning(used: int, limit: int) -> bool:
    return limit > 0 and used >= WARNING_THRESHOLD * limit
