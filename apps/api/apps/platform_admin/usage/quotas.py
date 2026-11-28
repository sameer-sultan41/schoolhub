"""The platform console's side of `core.tenancy.quotas`: the threshold notice (§12).

`hooks.register()` registers the limits (`subscriptions.services.effective_limits`), the
counters (`usage.services`' students, staff and storage bytes) and `threshold_reached`.
The notice is queued on commit, so a write that is rolled back sends nothing.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from django.db import transaction


def threshold_reached(
    tenant_id: uuid.UUID, metric: str, band: str, usage: int | Decimal, limit: int
) -> None:
    from apps.platform_admin.tasks import send_quota_threshold_notice

    kwargs = {
        "tenant_id": str(tenant_id),
        "metric": metric,
        "band": band,
        "usage": str(usage),
        "limit": limit,
    }
    transaction.on_commit(lambda: send_quota_threshold_notice.delay(**kwargs))
