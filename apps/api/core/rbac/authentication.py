"""The API's one authentication class (``DEFAULT_AUTHENTICATION_CLASSES``).

Kept apart from `core.rbac.impersonation`, and importing it only inside ``authenticate``:
DRF imports this class while ``rest_framework.views`` is still being defined, and a module-level
import of ``core.api.exceptions`` (which imports that module) would then be circular.
"""

from __future__ import annotations

import uuid
from typing import Any

from rest_framework_simplejwt.authentication import JWTAuthentication


def _uuid(value: Any) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except ValueError, TypeError, AttributeError:
        return None


class ImpersonationAwareJWTAuthentication(JWTAuthentication):
    """SimpleJWT's authentication, plus the grant check for an impersonation token (ADR-0037).

    A token carrying ``grant_id``, or the impersonation ``amr``, is accepted only while the
    registered checker finds its grant live for exactly this user and this operator. Anything
    else, a missing checker included, is a 401 ``impersonation_ended``. On success it sets
    ``request.impersonated_by`` (read by `core.audit.services.record_audit`) and
    ``request.impersonation`` (a `LiveGrant`). Every other token authenticates as before.
    """

    def authenticate(self, request):
        from core.rbac import impersonation

        result = super().authenticate(request)
        if result is None:
            return None
        user, token = result
        amr = token.get("amr")
        claims_impersonation = (
            isinstance(amr, list | tuple) and impersonation.IMPERSONATION_AMR in amr
        )
        if token.get(impersonation.GRANT_CLAIM) is None and not claims_impersonation:
            return result

        grant_id = _uuid(token.get(impersonation.GRANT_CLAIM))
        actor = token.get(impersonation.ACTOR_CLAIM)
        operator_id = _uuid(actor.get("sub")) if isinstance(actor, dict) else None
        live = None
        if grant_id is not None and operator_id is not None and not user.is_platform:
            live = impersonation.check_grant(
                grant_id, target_user_id=user.pk, operator_id=operator_id
            )
        if live is None:
            raise impersonation.ImpersonationEnded()

        request.impersonated_by = live.operator_id
        request.impersonation = live
        # DRF wraps the Django request; module code and audit reach for either.
        request._request.impersonated_by = live.operator_id
        request._request.impersonation = live
        # For the log lines of the rest of the request (`core.api.logging.JSONFormatter`).
        impersonation.bind_impersonation(live)
        return result
