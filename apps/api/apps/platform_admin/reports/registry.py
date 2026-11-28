"""The platform reports (platform-admin.md §13), each a set of named tables of aggregates.

Each report reads the platform-scope `tenants` columns and the metrics-only usage snapshots,
and nothing else: no school is bound and no school's own table is read (multi-tenancy §8).
Snapshot figures are as fresh as each school's latest snapshot (the nightly run, or
`:refresh-usage`).

A report is ``build() -> {section: [row, ...]}``; every row of a section has the same keys.
"""

from __future__ import annotations

import math
import statistics
from collections import Counter, defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal

from django.conf import settings
from django.db.models import Count
from django.db.models.functions import TruncMonth

from apps.platform_admin.models import Plan, TenantUsageSnapshot
from apps.platform_admin.usage.limits import COUNTED_METRICS, latest_snapshots, snapshot_usage
from core.tenancy.models import Tenant, TenantStatus

S = TenantStatus
Sections = dict[str, list[dict]]

#: Statuses whose subscription is recurring revenue: a suspended or deprovisioned school's
#: subscription row may still be live, but it is not being paid for.
REVENUE_STATUSES = (S.ACTIVE, S.PAST_DUE)
#: Statuses whose usage counts toward distributions, pressure and adoption.
OPERATIONAL_STATUSES = (S.TRIAL, S.ACTIVE, S.PAST_DUE, S.SUSPENDED)


@dataclass(frozen=True)
class Report:
    key: str
    title: str
    build: Callable[[], Sections]


def _month(value: datetime) -> str:
    return value.strftime("%Y-%m")


def _live_tenants():
    return Tenant.objects.filter(deleted_at__isnull=True)


def _latest(statuses) -> list[TenantUsageSnapshot]:
    """Each live school's newest snapshot, kept when that snapshot's status is in ``statuses``."""
    snapshots = latest_snapshots(_live_tenants().values_list("pk", flat=True))
    return [snapshot for snapshot in snapshots if snapshot.status in statuses]


def tenant_overview() -> Sections:
    """Schools by lifecycle status, signups per month, and churn per month."""
    counts = {
        row["status"]: row["n"]
        for row in _live_tenants().values("status").annotate(n=Count("pk")).order_by()
    }
    by_status = [{"status": value, "tenants": counts.get(value, 0)} for value in S.values]

    signups = (
        _live_tenants()
        .annotate(month=TruncMonth("created_at"))
        .values("month")
        .annotate(n=Count("pk"))
        .order_by("month")
    )
    # A school is deprovisioned at `deprovision_after - PLATFORM_RETENTION_DAYS` (the
    # lifecycle sets the one from the other); a restore clears `deprovision_after`.
    retention = timedelta(days=settings.PLATFORM_RETENTION_DAYS)
    churned = Counter(
        _month(after - retention)
        for after in _live_tenants()
        .filter(status=S.DEPROVISIONED, deprovision_after__isnull=False)
        .values_list("deprovision_after", flat=True)
    )
    return {
        "by_status": by_status,
        "signups": [{"month": _month(row["month"]), "tenants": row["n"]} for row in signups],
        "churn": [{"month": month, "tenants": churned[month]} for month in sorted(churned)],
    }


def revenue() -> Sections:
    """MRR and ARR per plan and currency, never summed across currencies, with past-due counts.

    `paying_tenants` counts every school whose subscription is billed, past-due ones included;
    `past_due` is the subset whose payment failed.
    """
    totals: dict[tuple[str, str], dict] = {}
    for snapshot in _latest(REVENUE_STATUSES):
        if not snapshot.currency:
            continue
        row = totals.setdefault(
            (snapshot.plan_code, snapshot.currency),
            {
                "plan_code": snapshot.plan_code,
                "currency": snapshot.currency,
                "paying_tenants": 0,
                "past_due": 0,
                "mrr": Decimal("0.00"),
            },
        )
        row["paying_tenants"] += 1
        row["past_due"] += snapshot.status == S.PAST_DUE
        row["mrr"] += snapshot.mrr_amount
    rows = [
        {**row, "mrr": f"{row['mrr']:.2f}", "arr": f"{row['mrr'] * 12:.2f}"}
        for _, row in sorted(totals.items())
    ]
    return {"mrr": rows}


def _number(value: int | Decimal | float) -> str:
    return f"{Decimal(str(value)):.2f}"


def usage() -> Sections:
    """Usage per metric across schools, the schools near a plan limit, and module adoption."""
    snapshots = _latest(OPERATIONAL_STATUSES)
    usages = [(snapshot, snapshot_usage(snapshot)) for snapshot in snapshots]

    distribution = []
    for metric in COUNTED_METRICS:
        values = sorted(Decimal(str(used[metric])) for _, used in usages)
        if not values:
            distribution.append(
                {"metric": metric, "tenants": 0, "min": "", "median": "", "p90": "", "max": ""}
            )
            continue
        # Nearest rank: the ceil(0.9 n)-th smallest.
        p90 = values[math.ceil(0.9 * len(values)) - 1]
        distribution.append(
            {
                "metric": metric,
                "tenants": len(values),
                "min": _number(values[0]),
                "median": _number(statistics.median(values)),
                "p90": _number(p90),
                "max": _number(values[-1]),
            }
        )

    # Plan limits only: a school's own override lives under its RLS boundary.
    codes = {snapshot.plan_code for snapshot in snapshots if snapshot.plan_code}
    limits = dict(Plan.objects.filter(code__in=codes).values_list("code", "limits"))
    ratio = Decimal(str(settings.PLATFORM_QUOTA_WARN_RATIO))
    pressure = []
    for snapshot, used in usages:
        for metric in COUNTED_METRICS:
            limit = (limits.get(snapshot.plan_code) or {}).get(metric)
            if limit is None:  # unlimited
                continue
            usage = Decimal(str(used[metric]))
            # A zero limit is under pressure as soon as anything is in use.
            under = usage == 0 if limit == 0 else usage < ratio * limit
            if under:
                continue
            pressure.append(
                {
                    "tenant_id": str(snapshot.tenant_id),
                    "plan_code": snapshot.plan_code,
                    "metric": metric,
                    "usage": _number(usage),
                    "limit": limit,
                    "ratio": _number(usage / limit) if limit else None,
                }
            )
    # Highest ratio first; a zero limit in use has no ratio and leads.
    pressure.sort(
        key=lambda row: Decimal("Infinity") if row["ratio"] is None else Decimal(row["ratio"]),
        reverse=True,
    )

    adoption: dict[tuple[str, str], int] = defaultdict(int)
    for snapshot in snapshots:
        for module in snapshot.modules_enabled:
            adoption[(snapshot.plan_code, module)] += 1
    on_plan = Counter(snapshot.plan_code for snapshot in snapshots)
    return {
        "distribution": distribution,
        "quota_pressure": pressure,
        "adoption": [
            {
                "plan_code": plan_code,
                "module": module,
                "tenants": count,
                "plan_tenants": on_plan[plan_code],
            }
            for (plan_code, module), count in sorted(adoption.items())
        ],
    }


REPORTS: dict[str, Report] = {
    report.key: report
    for report in (
        Report("tenant-overview", "Tenant overview", tenant_overview),
        Report("revenue", "Revenue", revenue),
        Report("usage", "Usage and adoption", usage),
    )
}
