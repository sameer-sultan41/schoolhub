"""Running a periodic job across every tenant, one bound transaction at a time.

Scheduled maintenance has no request and therefore no tenant, but it still has
to touch tenant-owned tables — and it cannot shortcut that with the
``all_tenants`` manager. The RLS policy every tenant-owned table carries reads
``NULLIF(current_setting('app.tenant_id', true), '')::uuid``, which is NULL when
nothing is bound, so ``tenant_id = NULL`` is NULL, so *no row is visible*. An
unbound `all_tenants.delete()` would not raise; it would report deleting zero
rows and the operator would believe the job ran. Failing silently is worse than
failing loudly, so the only correct shape is to bind each tenant in turn.

Cost is one small transaction per tenant per tick, which is the right trade at
this scale: these jobs run hourly or daily over indexed, narrow deletes, and a
slow tenant delays only itself.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable, Iterator

from core.tenancy.context import tenant_atomic

logger = logging.getLogger(__name__)


def active_tenant_ids() -> Iterator[uuid.UUID]:
    """Every tenant a maintenance job should visit.

    Suspended and archived tenants are included deliberately: retention is a
    legal obligation that does not pause when a school stops paying, and
    skipping them would let pruning silently stall on exactly the tenants whose
    data should be shrinking. Hard-deleted tenants have no rows left to visit.
    """
    from core.tenancy.models import Tenant

    return iter(Tenant.objects.filter(deleted_at__isnull=True).values_list("pk", flat=True))


def for_each_tenant(step: Callable[[uuid.UUID], int], *, job: str) -> dict[str, int]:
    """Run ``step`` once per tenant inside that tenant's own transaction.

    ``step`` returns the number of rows it acted on. One tenant raising does not
    abort the sweep — it is logged and the next tenant still runs, because a
    single tenant's bad data must not stop retention platform-wide.
    """
    visited = affected = failed = 0

    for tenant_id in active_tenant_ids():
        visited += 1
        try:
            with tenant_atomic(tenant_id):
                affected += step(tenant_id)
        except Exception:
            failed += 1
            logger.exception("%s failed for tenant %s", job, tenant_id)

    logger.info(
        "%s swept %d tenant(s): %d row(s) affected, %d failure(s)", job, visited, affected, failed
    )
    return {"tenants": visited, "affected": affected, "failed": failed}
