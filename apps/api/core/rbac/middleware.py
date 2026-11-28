"""One log line per impersonated request, so a read is attributable too (ADR-0037).

A mutation under impersonation already writes an audit row with ``impersonated_by``; a read
writes none. This names the operator, the user acted as, the method, the path and the status of
every impersonated request, and scopes the impersonation context the authenticator binds (so
`core.api.logging.JSONFormatter` adds ``impersonated_by`` and ``grant_id`` to every line logged
while it runs) to this one request.
"""

from __future__ import annotations

import logging

from core.rbac.impersonation import bind_impersonation, unbind_impersonation

logger = logging.getLogger("core.rbac.impersonation")


class ImpersonationLogMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        token = bind_impersonation(None)
        try:
            response = self.get_response(request)
            live = getattr(request, "impersonation", None)
            if live is not None:
                logger.info(
                    "impersonated request",
                    extra={
                        "impersonated_by": str(live.operator_id),
                        "grant_id": str(live.grant_id),
                        "target_user_id": str(getattr(request.user, "pk", "") or ""),
                        "method": request.method,
                        "path": request.path,
                        "status": response.status_code,
                    },
                )
            return response
        finally:
            unbind_impersonation(token)
