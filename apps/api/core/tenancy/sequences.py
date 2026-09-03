"""Gapless per-tenant sequence allocation (database-architecture.md §4).

"Counters/sequences with gaps forbidden (receipt numbers, admission numbers per
tenant) use a per-tenant counter row updated FOR UPDATE in the same transaction
as the document it numbers." ``allocate_number`` is that primitive; every module
that needs a gapless number (student-management's admission_number today,
fees-finance's receipt numbers later) calls it from inside its own transaction.

Gapless here means values are never *reused* while the allocating transaction
commits: the counter and the row it numbers move together, so a rollback undoes
both. The only way a number is permanently skipped is a row that later gets
soft-deleted after committing — by then the number was legitimately issued once,
which is the documented, accepted behaviour (see the calling module's services
docstring), not a bug in this function.
"""

from __future__ import annotations

import uuid

from django.db import IntegrityError, transaction


def allocate_number(*, scope: str, series: str, tenant_id: uuid.UUID) -> int:
    """Return the next value for (tenant, scope, series), starting at 1.

    Must run inside an existing transaction: that is what makes the counter
    increment and the caller's INSERT atomic together. Calling this outside one
    is a bug in the caller, not a recoverable condition, so it raises rather than
    silently opening its own transaction (which would defeat the guarantee).
    """
    from core.tenancy.models import TenantCounter

    if not transaction.get_connection().in_atomic_block:
        raise RuntimeError(
            "allocate_number() must run inside the same transaction as the row it "
            "numbers (database-architecture.md §4). Wrap the caller in "
            "transaction.atomic()."
        )

    counter = TenantCounter.objects.select_for_update().filter(scope=scope, series=series).first()
    if counter is None:
        counter = _create_counter(tenant_id=tenant_id, scope=scope, series=series)

    value = counter.next_value
    counter.next_value = value + 1
    counter.save(update_fields=["next_value", "updated_at"])
    return value


def _create_counter(*, tenant_id: uuid.UUID, scope: str, series: str):
    """First-ever allocation for this (tenant, scope, series).

    A concurrent first allocation can race here: both transactions see no row and
    both try to create one. The partial unique constraint rejects the loser, who
    then re-selects FOR UPDATE and proceeds normally — a savepoint keeps that
    failure from poisoning the outer transaction.
    """
    from core.tenancy.models import TenantCounter

    try:
        with transaction.atomic():
            return TenantCounter.objects.create(
                tenant_id=tenant_id, scope=scope, series=series, next_value=1
            )
    except IntegrityError:
        return TenantCounter.objects.select_for_update().get(scope=scope, series=series)
