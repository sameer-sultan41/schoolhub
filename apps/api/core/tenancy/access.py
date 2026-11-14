"""Whether a user's school may be served at all: the one rule every entry point applies.

`TenantMiddleware` (a session), `TenantScopedViewSetMixin` (a bearer token, after DRF
authenticates it), sign-in and token refresh all ask the same question, so they all call
`operational_tenant`. Asking it in one place is what keeps a suspended school from being
refused on one path and served on another.
"""

from __future__ import annotations

import logging
from typing import Any, Literal

from core.tenancy.models import Tenant

logger = logging.getLogger(__name__)

TenantRefusal = Literal["tenant_not_found", "tenant_suspended"]

TENANT_FIELDS = ("id", "name", "slug", "status", "timezone", "locale", "currency")


def operational_tenant(tenant_id: Any) -> tuple[Tenant | None, TenantRefusal | None]:
    """The tenant, or why it may not be served: deleted (`tenant_not_found`) or not
    `is_operational` (`tenant_suspended`: provisioning, suspended or deprovisioned)."""
    tenant = (
        Tenant.objects.filter(pk=tenant_id, deleted_at__isnull=True).only(*TENANT_FIELDS).first()
    )
    if tenant is None:
        return None, "tenant_not_found"
    if not tenant.is_operational:
        return tenant, "tenant_suspended"
    return tenant, None


def log_refusal(refusal: TenantRefusal, *, path: str | None) -> None:
    logger.warning("tenant resolution denied: %s", refusal, extra={"path": path})


def user_may_authenticate(user: Any) -> bool:
    """simplejwt's `USER_AUTHENTICATION_RULE`: active, and of a school that may be served.

    Token refresh applies it, so a suspended school's user stops getting new access
    tokens; a platform user has no tenant and is judged on `is_active` alone, as the
    default rule does.
    """
    if user is None or not user.is_active:
        return False
    tenant_id = getattr(user, "tenant_id", None)
    if tenant_id is None:
        return True
    _, refusal = operational_tenant(tenant_id)
    return refusal is None
