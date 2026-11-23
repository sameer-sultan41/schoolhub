"""Plan quotas, checked where a counted thing is created (platform-admin.md §5, §11).

Plans belong to the platform console's app and ``core`` imports no app (ADR-0013), so that
app fills three seams from ``AppConfig.ready()``:

- ``register_quota_resolver(fn)``: each metric's limit for a school, ``None`` = unlimited;
- ``register_usage_counter(metric, fn)``: the school's current usage, in the limit's unit;
- ``register_threshold_listener(fn)``: told when a write moves usage into a higher band.

Modules call ``check_quota`` from their create services, before the insert, in the insert's
transaction. With nothing registered, no limit, or no counter for the metric, it allows.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from django.conf import settings

from core.api.exceptions import CodedAPIException
from core.api.warnings import add_response_warning
from core.tenancy.context import TenantContextRequired, get_current_tenant_id
from core.tenancy.locks import AdvisoryLockNamespace, advisory_xact_lock

#: The `storage_gb` limit is in GiB; uploads are sized in bytes.
BYTES_PER_GB = 1024**3

#: The bands a school's usage can be in, lowest first.
WARN = "warn"
LIMIT = "limit"

type Usage = int | Decimal
type QuotaResolver = Callable[[uuid.UUID], Mapping[str, int | None]]
type UsageCounter = Callable[[uuid.UUID], Usage]
type ThresholdListener = Callable[[uuid.UUID, str, str, Usage, int], None]

# Keyed so a test can swap an entry with `mock.patch.dict`.
_hooks: dict[str, Any] = {}
_counters: dict[str, UsageCounter] = {}


def bytes_to_gb(size_bytes: int) -> Decimal:
    """Bytes in GiB, the unit of the `storage_gb` limit."""
    return Decimal(size_bytes) / BYTES_PER_GB


def _shown(usage: Usage) -> Usage:
    """Usage as a client sees it: a fractional unit (GiB) to three places."""
    return usage.quantize(Decimal("0.001")) if isinstance(usage, Decimal) else usage


def _register(key: str, fn: Any) -> None:
    existing = _hooks.get(key)
    if existing is not None and existing is not fn:
        raise ValueError(f"A quota {key} is already registered.")
    _hooks[key] = fn


def register_quota_resolver(fn: QuotaResolver) -> None:
    """Register the limits. Call it only with the school already bound."""
    _register("resolver", fn)


def register_threshold_listener(fn: ThresholdListener) -> None:
    """Register ``fn(tenant_id, metric, band, usage, limit)``, called in the write's transaction."""
    _register("listener", fn)


def register_usage_counter(metric: str, fn: UsageCounter) -> None:
    existing = _counters.get(metric)
    if existing is not None and existing is not fn:
        raise ValueError(f"A usage counter for {metric!r} is already registered.")
    _counters[metric] = fn


class QuotaExceeded(CodedAPIException):
    status_code = 409
    default_detail = "This school has reached its plan's limit."
    default_code = "quota_exceeded"


@dataclass(frozen=True)
class QuotaWarning:
    """Usage at or past `PLATFORM_QUOTA_WARN_RATIO` of the limit, after this write."""

    metric: str
    limit: int
    usage: Usage

    code = "quota_warning"

    @property
    def message(self) -> str:
        return f"This school is using {_shown(self.usage)} of its {self.limit} {self.metric} limit."

    def as_dict(self) -> dict[str, object]:
        return {
            "code": self.code,
            "message": self.message,
            "details": {"metric": self.metric, "limit": self.limit, "usage": _shown(self.usage)},
        }


def band(usage: Usage, limit: int) -> str | None:
    if usage >= limit:
        return LIMIT
    if usage >= limit * Decimal(str(settings.PLATFORM_QUOTA_WARN_RATIO)):
        return WARN
    return None


def check_quota(tenant_id: uuid.UUID, metric: str, *, adding: Usage = 1) -> QuotaWarning | None:
    """Refuse a write that would take ``metric`` past the school's limit.

    Raises `QuotaExceeded` (409, ``meta={metric, limit, usage}``, usage before this write).
    Returns a `QuotaWarning`, also added to the response's ``meta.warnings``, when usage
    after the write is in the warn band or at the limit. Concurrent writes serialise on a
    transaction-scoped advisory lock per school and metric, taken before counting, so two
    creates at limit − 1 cannot both pass.
    """
    resolver = _hooks.get("resolver")
    counter = _counters.get(metric)
    if resolver is None or counter is None:
        return None
    if get_current_tenant_id() != tenant_id:
        raise TenantContextRequired(f"Quotas of tenant {tenant_id} are checked with it bound.")
    limit = resolver(tenant_id).get(metric)
    if limit is None:
        return None

    advisory_xact_lock(AdvisoryLockNamespace.QUOTA, uuid.uuid5(tenant_id, metric))
    usage = counter(tenant_id)
    after = usage + adding
    if after > limit:
        shown = _shown(usage)
        raise QuotaExceeded(
            f"This school has reached its plan's limit of {limit} {metric} (using {shown}).",
            meta={"metric": metric, "limit": limit, "usage": shown},
        )
    reached = band(after, limit)
    if reached is None:
        return None
    listener = _hooks.get("listener")
    if listener is not None and reached != band(usage, limit):
        listener(tenant_id, metric, reached, after, limit)
    warning = QuotaWarning(metric=metric, limit=limit, usage=after)
    add_response_warning(warning.as_dict())
    return warning
