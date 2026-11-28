"""Plan quotas, checked where a counted thing is created (platform-admin.md §5, §11).

Plans belong to the platform console's app and ``core`` imports no app (ADR-0013), so that
app fills three seams from ``AppConfig.ready()``:

- ``register_quota_resolver(fn)``: each metric's limit for a school, ``None`` = unlimited;
- ``register_usage_counter(metric, fn, unit=)``: the school's current usage, a whole count;
- ``register_threshold_listener(fn)``: told when a write moves usage into a higher band.

Modules call ``check_quota`` from their create services, before the insert, in the insert's
transaction; a pre-check on writes still to come (an import upload) calls ``assert_room``,
which only refuses. With nothing registered, no limit, or no counter for the metric, both allow.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from django.conf import settings
from drf_spectacular.utils import OpenApiResponse

from core.api.exceptions import CodedAPIException
from core.api.warnings import add_response_warning
from core.tenancy.context import TenantContextRequired, get_current_tenant_id
from core.tenancy.locks import AdvisoryLockNamespace, advisory_xact_lock

#: The `storage_gb` limit is in GiB; its counter and uploads are in bytes.
BYTES_PER_GB = 1024**3

#: The bands a school's usage can be in, lowest first.
WARN = "warn"
LIMIT = "limit"

type Usage = int | Decimal
type QuotaResolver = Callable[[uuid.UUID], Mapping[str, int | None]]
type UsageCounter = Callable[[uuid.UUID], int]
type ThresholdListener = Callable[[uuid.UUID, str, str, Usage, int], None]

# Keyed so a test can swap an entry with `mock.patch.dict`. A counter is stored with its unit:
# how many of the counter's units make one of the limit's (1, or `BYTES_PER_GB` for storage).
_hooks: dict[str, Any] = {}
_counters: dict[str, tuple[UsageCounter, int]] = {}


def bytes_to_gb(size_bytes: int) -> Decimal:
    """Bytes in GiB, the unit of the `storage_gb` limit."""
    return Decimal(size_bytes) / BYTES_PER_GB


def _shown(count: int, unit: int) -> Usage:
    """A count in the limit's unit, as a client sees it: GiB to three places."""
    if unit == 1:
        return count
    return (Decimal(count) / unit).quantize(Decimal("0.001"))


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


def register_usage_counter(metric: str, fn: UsageCounter, *, unit: int = 1) -> None:
    """Register ``metric``'s counter. It returns a whole count; ``unit`` of them make one of
    the limit's units, so comparisons stay in integers (storage: bytes against GiB)."""
    existing = _counters.get(metric)
    if existing is not None and existing != (fn, unit):
        raise ValueError(f"A usage counter for {metric!r} is already registered.")
    _counters[metric] = (fn, unit)


class QuotaExceeded(CodedAPIException):
    status_code = 409
    default_detail = "This school has reached its plan's limit."
    default_code = "quota_exceeded"


#: The 409 every quota-checked create declares in OpenAPI.
QUOTA_EXCEEDED_RESPONSE = OpenApiResponse(
    description="quota_exceeded: the school's plan limit would be passed "
    "(`meta` {metric, limit, usage, adding})."
)


@dataclass(frozen=True)
class QuotaWarning:
    """Usage at or past `PLATFORM_QUOTA_WARN_RATIO` of the limit, after this write."""

    metric: str
    limit: int
    usage: Usage

    code = "quota_warning"

    @property
    def message(self) -> str:
        return f"This school is using {self.usage} of its {self.limit} {self.metric} limit."

    def as_dict(self) -> dict[str, object]:
        return {
            "code": self.code,
            "message": self.message,
            "details": {"metric": self.metric, "limit": self.limit, "usage": self.usage},
        }


def band(count: int, limit_count: int) -> str | None:
    """The band of ``count`` against ``limit_count``, both in the counter's own units."""
    if count >= limit_count:
        return LIMIT
    if count >= limit_count * Decimal(str(settings.PLATFORM_QUOTA_WARN_RATIO)):
        return WARN
    return None


@dataclass(frozen=True)
class _Room:
    metric: str
    limit: int
    unit: int
    usage: int  # before the write, in the counter's units
    after: int


def _measure(tenant_id: uuid.UUID, metric: str, adding: int) -> _Room | None:
    """Lock, count and refuse past the limit; None when the metric is unlimited here."""
    resolver = _hooks.get("resolver")
    registered = _counters.get(metric)
    if resolver is None or registered is None:
        return None
    if get_current_tenant_id() != tenant_id:
        raise TenantContextRequired(f"Quotas of tenant {tenant_id} are checked with it bound.")
    limit = resolver(tenant_id).get(metric)
    if limit is None:
        return None
    counter, unit = registered

    advisory_xact_lock(AdvisoryLockNamespace.QUOTA, uuid.uuid5(tenant_id, metric))
    usage = counter(tenant_id)
    after = usage + adding
    if after > limit * unit:
        shown = _shown(usage, unit)
        raise QuotaExceeded(
            f"This school has reached its plan's limit of {limit} {metric} (using {shown}).",
            meta={
                "metric": metric,
                "limit": limit,
                "usage": shown,
                "adding": _shown(adding, unit),
            },
        )
    return _Room(metric=metric, limit=limit, unit=unit, usage=usage, after=after)


def assert_room(tenant_id: uuid.UUID, metric: str, *, adding: int) -> None:
    """Refuse-only: `QuotaExceeded` if ``adding`` more would pass the limit, nothing else.

    For a pre-check on writes that have not happened yet (an import upload): no warning and
    no threshold notice, because the rows may never be created. Each real create checks again.
    """
    _measure(tenant_id, metric, adding)


def check_quota(tenant_id: uuid.UUID, metric: str, *, adding: int = 1) -> QuotaWarning | None:
    """Refuse a write that would take ``metric`` past the school's limit; advise near it.

    ``adding`` is in the counter's units (bytes for `storage_gb`). Raises `QuotaExceeded`
    (409, ``meta={metric, limit, usage, adding}``, usage before this write). Returns a
    `QuotaWarning`, also added to the response's ``meta.warnings``, when usage after the write
    is in the warn band or at the limit, and tells the threshold listener when the write moves
    usage into a higher band. Concurrent writes serialise on a transaction-scoped advisory lock
    per school and metric, taken before counting, so two creates at limit − 1 cannot both pass.
    """
    room = _measure(tenant_id, metric, adding)
    if room is None:
        return None
    limit_count = room.limit * room.unit
    reached = band(room.after, limit_count)
    if reached is None:
        return None
    after = _shown(room.after, room.unit)
    listener = _hooks.get("listener")
    if listener is not None and reached != band(room.usage, limit_count):
        listener(tenant_id, metric, reached, after, room.limit)
    warning = QuotaWarning(metric=metric, limit=room.limit, usage=after)
    add_response_warning(warning.as_dict())
    return warning
