"""The tenant-aware Celery base task config/celery.py's docstring references.

Every task that touches tenant-owned data must run with the initiating
request's tenant bound for `TenantManager`'s default-queryset filtering
(core.tenancy.managers), which every read and write in the task relies on
regardless of database transactions. This binds only that Python-side context
for the task's whole duration — it deliberately does NOT also open one
transaction spanning the entire task body the way
TenantScopedViewSetMixin.initial() does for a synchronous request (that relies
on Django's ATOMIC_REQUESTS wrapping the whole, short-lived view call).

A Celery task is not short-lived the way a request is: it can run a long loop
with per-row/per-step progress that a caller polls for (`GET /jobs/{id}`), and
`SET LOCAL`-based RLS enforcement (core.tenancy.context.set_database_tenant)
only has effect inside whatever transaction is open when it runs. Wrapping the
whole task in one transaction would hold every write in it — job progress
included — uncommitted, and therefore invisible to that polling connection,
until the task fully returns; a killed worker would discard all of it,
including any failure state the task was trying to record on its way out.
Each database-touching step inside a task must instead use
`core.tenancy.context.tenant_atomic`, which opens its own transaction and
re-applies the GUC for it — see that function's docstring.

Usage::

    @shared_task(base=TenantAwareTask, bind=True)
    def my_task(self, *, tenant_id: str, ...):
        ...  # runs with the tenant already bound (Python-side only — each
        ...  # database-touching step still needs its own tenant_atomic(...))
"""

from __future__ import annotations

import uuid

from celery import Task

from core.tenancy.context import bind_tenant, unbind_tenant


class TenantAwareTask(Task):
    abstract = True

    def __call__(self, *args, **kwargs):
        tenant_id = kwargs.get("tenant_id")
        if not tenant_id:
            raise ValueError("TenantAwareTask requires a tenant_id keyword argument.")
        token = bind_tenant(uuid.UUID(str(tenant_id)))
        try:
            return super().__call__(*args, **kwargs)
        finally:
            unbind_tenant(token)
