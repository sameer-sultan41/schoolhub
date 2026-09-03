"""The tenant-aware Celery base task config/celery.py's docstring references.

Every task that touches tenant-owned data must run inside the initiating
request's tenant context — `SET LOCAL` (core.tenancy.context.set_database_tenant)
only takes effect inside a transaction, so this opens one and binds the tenant
before the task body runs (database-architecture.md §1.1), mirroring what
TenantScopedViewSetMixin.initial()/finalize_response() give a synchronous
request.

Usage::

    @shared_task(base=TenantAwareTask, bind=True)
    def my_task(self, *, tenant_id: str, ...):
        ...  # runs with the tenant already bound
"""

from __future__ import annotations

import uuid

from celery import Task
from django.db import transaction

from core.tenancy.context import tenant_context


class TenantAwareTask(Task):
    abstract = True

    def __call__(self, *args, **kwargs):
        tenant_id = kwargs.get("tenant_id")
        if not tenant_id:
            raise ValueError("TenantAwareTask requires a tenant_id keyword argument.")
        with transaction.atomic(), tenant_context(uuid.UUID(str(tenant_id))):
            return super().__call__(*args, **kwargs)
