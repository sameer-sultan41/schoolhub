"""The 409 `limit_below_usage`: a limit lowered below a school's latest snapshot (ruling C3).

Both limit writes ask it: a plan's `limits` (every school whose `current_plan` is the plan)
and a subscription's `limits_override` (that one school). Only the three counted metrics are
checked; `sms_credits` and `ai_tokens` have no counter yet (deferred-work.md).

It reads snapshots only, a platform table, so it needs no school bound. A snapshot is as
fresh as the last nightly run or `:refresh-usage`.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from decimal import Decimal

from apps.platform_admin.models import TenantUsageSnapshot
from core.api.exceptions import CodedAPIException
from core.tenancy.quotas import bytes_to_gb

#: The quota metrics a snapshot counts, in `QUOTA_METRICS` order.
COUNTED_METRICS = ("students", "staff", "storage_gb")

Limits = dict[str, int | None]


class LimitBelowUsage(CodedAPIException):
    status_code = 409
    default_detail = (
        "This limit is below a school's current usage. Send acknowledge_over_usage: true to "
        "lower it anyway."
    )
    default_code = "limit_below_usage"


def storage_gb(storage_bytes: int) -> Decimal:
    """Bytes in GiB, the unit of the `storage_gb` limit (the quota check's own conversion)."""
    return bytes_to_gb(storage_bytes)


def snapshot_usage(snapshot: TenantUsageSnapshot) -> dict[str, int | Decimal]:
    """A snapshot's usage per counted metric, in each limit's own unit."""
    return {
        "students": snapshot.students,
        "staff": snapshot.staff,
        "storage_gb": storage_gb(snapshot.storage_bytes),
    }


def latest_snapshots(tenant_ids: Iterable[uuid.UUID]) -> list[TenantUsageSnapshot]:
    """Each school's newest snapshot; a school with none is left out."""
    return list(
        TenantUsageSnapshot.objects.filter(tenant_id__in=list(tenant_ids))
        .order_by("tenant_id", "-taken_at")
        .distinct("tenant_id")
    )


def breaches(before: Limits, after: Limits, snapshots: Iterable[TenantUsageSnapshot]) -> list[dict]:
    """Every (school, metric) whose limit goes down and ends below the school's usage.

    A limit that stays or rises is never a breach, so an edit that leaves an already-exceeded
    limit alone needs no acknowledgement. ``None`` is unlimited.
    """
    lowered: dict[str, int] = {}
    for metric in COUNTED_METRICS:
        new, old = after.get(metric), before.get(metric)
        if new is not None and (old is None or new < old):
            lowered[metric] = new
    found = []
    for snapshot in snapshots:
        used = snapshot_usage(snapshot)
        for metric, limit in lowered.items():
            if used[metric] > limit:
                found.append(
                    {
                        "tenant_id": str(snapshot.tenant_id),
                        "metric": metric,
                        "limit": limit,
                        "usage": _json_number(used[metric]),
                    }
                )
    return found


def refuse_below_usage(
    before: Limits,
    after: Limits,
    snapshots: Iterable[TenantUsageSnapshot],
    *,
    acknowledged: bool,
) -> None:
    """Raise `LimitBelowUsage`, listing each breach in ``meta.over_usage``, unless acknowledged."""
    if acknowledged:
        return
    found = breaches(before, after, snapshots)
    if found:
        raise LimitBelowUsage(meta={"over_usage": found})


def _json_number(value: int | Decimal) -> int | float:
    return value if isinstance(value, int) else round(float(value), 3)
