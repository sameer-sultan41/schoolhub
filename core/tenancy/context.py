"""Per-request tenant context.

The active tenant is held in a ContextVar rather than thread-local storage so it
behaves correctly under ASGI/async views as well as WSGI.
"""

from __future__ import annotations

import contextlib
import uuid
from contextvars import ContextVar

from django.db import connection

_current_tenant_id: ContextVar[uuid.UUID | None] = ContextVar("current_tenant_id", default=None)

# The PostgreSQL GUC the RLS policies read. Must stay in sync with the policy SQL
# in core/tenancy/migrations/0002_rls_policies.py.
TENANT_GUC = "app.tenant_id"


def get_current_tenant_id() -> uuid.UUID | None:
    return _current_tenant_id.get()


def set_database_tenant(tenant_id: uuid.UUID | None) -> None:
    """Bind the tenant for the *current transaction*.

    SET LOCAL is mandatory: connections are pooled by PgBouncer in transaction mode,
    so a session-level SET would leak one tenant's context into another tenant's
    request. See docs/02-architecture/database-architecture.md.
    """
    with connection.cursor() as cursor:
        if tenant_id is None:
            cursor.execute(f"RESET {TENANT_GUC}")
        else:
            # set_config's third argument = is_local, i.e. transaction-scoped.
            cursor.execute("SELECT set_config(%s, %s, true)", [TENANT_GUC, str(tenant_id)])


@contextlib.contextmanager
def tenant_context(tenant_id: uuid.UUID | None):
    """Activate a tenant for the enclosing block, in Python and in the database.

    Used by the request middleware, Celery tasks, and management commands so that
    background work is scoped exactly like a request.
    """
    token = _current_tenant_id.set(tenant_id)
    try:
        set_database_tenant(tenant_id)
        yield
    finally:
        _current_tenant_id.reset(token)
        # The GUC is transaction-scoped, so it unwinds with the transaction; resetting
        # here would fail outside one and is unnecessary.


class TenantContextRequired(RuntimeError):
    """Raised when tenant-scoped data is queried with no active tenant."""


def require_current_tenant_id() -> uuid.UUID:
    tenant_id = get_current_tenant_id()
    if tenant_id is None:
        raise TenantContextRequired(
            "No active tenant. Use tenant_context(...) or the unfiltered "
            "`all_tenants` manager if this is deliberate platform-scope code."
        )
    return tenant_id
