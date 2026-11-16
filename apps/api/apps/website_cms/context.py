"""Reading one tenant's RLS-protected rows from helpers callable inside or outside a request."""

from __future__ import annotations

import contextlib
from collections.abc import Iterator

from core.tenancy.context import get_current_tenant_id, tenant_atomic
from core.tenancy.models import Tenant


class TenantContextMismatch(RuntimeError):
    """A helper was asked about one tenant while another tenant is bound."""


@contextlib.contextmanager
def bound_to(tenant: Tenant) -> Iterator[None]:
    """Run the block with ``tenant`` bound: reuse a binding to it, bind it if none, else raise.

    Never re-binds over another tenant, whose transaction-local GUC would otherwise be left
    pointing at ``tenant`` after the block.
    """
    current = get_current_tenant_id()
    if current == tenant.pk:
        yield
        return
    if current is not None:
        raise TenantContextMismatch(f"tenant {current} is bound; refusing to read {tenant.pk}")
    with tenant_atomic(tenant.pk):
        yield
