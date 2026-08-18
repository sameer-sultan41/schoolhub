"""Resolves the tenant for each request and binds it for the transaction."""

from __future__ import annotations

import logging

from django.http import JsonResponse

from core.tenancy.context import tenant_context
from core.tenancy.models import Tenant

logger = logging.getLogger(__name__)


class TenantMiddleware:
    """Bind ``request.tenant`` and the database GUC used by RLS.

    Resolution order (docs/02-architecture/multi-tenancy.md §4):
      1. Authenticated principal — the account is bound to exactly one tenant.
      2. Platform principals — no tenant is bound; they use platform-scope endpoints.

    Public website traffic does not reach this service directly; the renderer calls
    the public API with a scoped machine token whose principal carries the tenant.
    """

    EXEMPT_PREFIXES = ("/api/v1/auth/", "/api/v1/public/", "/api/schema", "/admin/", "/healthz")

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.tenant = None
        user = getattr(request, "user", None)

        if user is not None and user.is_authenticated and getattr(user, "tenant_id", None):
            tenant = (
                Tenant.objects.filter(pk=user.tenant_id, deleted_at__isnull=True)
                .only("id", "name", "slug", "status", "timezone", "locale", "currency")
                .first()
            )
            if tenant is None:
                return self._deny(request, "tenant_not_found")
            if not tenant.is_operational:
                return self._deny(request, "tenant_suspended", status=403)

            request.tenant = tenant
            # ATOMIC_REQUESTS wraps the view in a transaction, so the SET LOCAL this
            # performs binds for exactly this request and unwinds with it.
            with tenant_context(tenant.id):
                return self.get_response(request)

        return self.get_response(request)

    def _deny(self, request, code: str, status: int = 404) -> JsonResponse:
        logger.warning("tenant resolution denied: %s", code, extra={"path": request.path})
        return JsonResponse(
            {
                "error": {
                    "code": code,
                    "message": "Tenant is not available.",
                    "details": [],
                    "request_id": getattr(request, "request_id", None),
                }
            },
            status=status,
        )
