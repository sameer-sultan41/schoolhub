"""The usage counters, and the snapshots written from them (platform-admin.md §5, §13).

**The one implementation of the counters** (ruling A5). Quota enforcement reuses
`USAGE_COUNTERS` rather than counting again. The definitions are fixed:

- `students`: students not soft-deleted whose status is not withdrawn, graduated or
  transferred;
- `staff`: staff not soft-deleted who have not left (resigned, retired or terminated);
- `storage_gb`: the sum of the school's files' `size_bytes`, soft-deleted files excluded,
  in GiB.

Each counter reads tenant-owned tables, so it runs with exactly that school bound and refuses
any other (`TenantContextRequired`): RLS would otherwise return another school's count, or
none, without an error. The nightly visit binds one school per step (`for_each_tenant`), and
the console's routes bind the one they name.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from decimal import Decimal

from django.db.models import Sum

from apps.platform_admin.models import BillingPeriod, SubscriptionStatus, TenantUsageSnapshot
from apps.platform_admin.subscriptions.services import live_subscription
from apps.platform_admin.usage.limits import storage_gb
from apps.staff_management.models import EmploymentStatus, Staff
from apps.student_management.models import Student, StudentStatus
from core.files.models import File
from core.tenancy.context import TenantContextRequired, get_current_tenant_id
from core.tenancy.features import is_feature_enabled
from core.tenancy.features import registry as feature_registry
from core.tenancy.models import Tenant

#: Students who have left the school, and so hold no place.
LEFT_STUDENT_STATUSES = (
    StudentStatus.WITHDRAWN,
    StudentStatus.GRADUATED,
    StudentStatus.TRANSFERRED,
)
#: Staff who have left (the spec's "exited").
EXITED_STAFF_STATUSES = (
    EmploymentStatus.RESIGNED,
    EmploymentStatus.RETIRED,
    EmploymentStatus.TERMINATED,
)
#: Revenue counts while the school pays, late or not; a trial brings none.
PAYING_STATUSES = (SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE)
_MONTHS: dict[str, int] = {BillingPeriod.MONTHLY: 1, BillingPeriod.ANNUAL: 12}
_CENT = Decimal("0.01")


def _require_bound(tenant_id: uuid.UUID) -> None:
    if get_current_tenant_id() != tenant_id:
        raise TenantContextRequired(
            f"Usage of tenant {tenant_id} is counted with that tenant bound, and only then."
        )


def count_students(tenant_id: uuid.UUID) -> int:
    _require_bound(tenant_id)
    return (
        Student.objects.filter(deleted_at__isnull=True)
        .exclude(status__in=LEFT_STUDENT_STATUSES)
        .count()
    )


def count_staff(tenant_id: uuid.UUID) -> int:
    _require_bound(tenant_id)
    return (
        Staff.objects.filter(deleted_at__isnull=True)
        .exclude(employment_status__in=EXITED_STAFF_STATUSES)
        .count()
    )


def count_storage_bytes(tenant_id: uuid.UUID) -> int:
    _require_bound(tenant_id)
    total = File.objects.filter(deleted_at__isnull=True).aggregate(total=Sum("size_bytes"))
    return total["total"] or 0


def count_storage_gb(tenant_id: uuid.UUID) -> Decimal:
    return storage_gb(count_storage_bytes(tenant_id))


#: Each counted quota metric's counter, in the limit's own unit. Quota checks use these.
USAGE_COUNTERS: dict[str, Callable[[uuid.UUID], int | Decimal]] = {
    "students": count_students,
    "staff": count_staff,
    "storage_gb": count_storage_gb,
}


def monthly_amount(price: Decimal, billing_period: str) -> Decimal:
    """A plan's price per month: an annual price over twelve, to the cent."""
    return (price / _MONTHS[billing_period]).quantize(_CENT)


def snapshot_tenant(tenant_id: uuid.UUID) -> TenantUsageSnapshot:
    """Append a snapshot of the bound school: its counts, plan, revenue and modules.

    Runs inside that school's context (a `for_each_tenant` step or a request nested under
    it); `live_subscription` rebinds the same school, which is safe for that reason only.
    """
    _require_bound(tenant_id)
    tenant = Tenant.objects.get(pk=tenant_id)
    sub = live_subscription(tenant_id)
    paying = sub is not None and sub.status in PAYING_STATUSES
    return TenantUsageSnapshot.objects.create(
        tenant=tenant,
        status=tenant.status,
        plan_code=sub.plan.code if sub is not None else "",
        mrr_amount=(
            monthly_amount(sub.plan.price_amount, sub.plan.billing_period)
            if sub is not None and paying
            else Decimal("0")
        ),
        currency=sub.plan.currency if sub is not None else "",
        students=count_students(tenant_id),
        staff=count_staff(tenant_id),
        storage_bytes=count_storage_bytes(tenant_id),
        modules_enabled=sorted(
            spec.key
            for spec in feature_registry.all()
            if spec.key.startswith("module.") and is_feature_enabled(spec.key, tenant_id=tenant_id)
        ),
    )


def snapshot_step(tenant_id: uuid.UUID) -> int:
    """`for_each_tenant`'s step for the nightly visit: one snapshot, one row."""
    snapshot_tenant(tenant_id)
    return 1


def latest_snapshot(tenant_id: uuid.UUID) -> TenantUsageSnapshot | None:
    """The school's newest snapshot, or None. A platform table: no school need be bound."""
    return TenantUsageSnapshot.objects.filter(tenant_id=tenant_id).order_by("-taken_at").first()
