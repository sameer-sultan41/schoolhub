"""Uniform error envelope.

Contract (docs/02-architecture/api-architecture.md §2.3)::

    {"error": {"code", "message", "details": [{"field", "issue"}], "request_id"}}

Status codes: 400 validation, 401 unauthenticated, 403 permission, 404 not-found
*and cross-tenant* (never reveal existence), 409 conflict, 422 domain-rule,
429 rate-limited.
"""

from __future__ import annotations

import logging

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.db import IntegrityError
from django.http import Http404
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

logger = logging.getLogger(__name__)

_CODE_BY_STATUS = {
    status.HTTP_400_BAD_REQUEST: "validation_error",
    status.HTTP_401_UNAUTHORIZED: "unauthenticated",
    status.HTTP_403_FORBIDDEN: "permission_denied",
    status.HTTP_404_NOT_FOUND: "not_found",
    status.HTTP_405_METHOD_NOT_ALLOWED: "method_not_allowed",
    status.HTTP_409_CONFLICT: "conflict",
    status.HTTP_422_UNPROCESSABLE_ENTITY: "unprocessable",
    status.HTTP_429_TOO_MANY_REQUESTS: "rate_limited",
}


class DomainRuleViolation(exceptions.APIException):
    """A request that is well-formed but violates a business rule."""

    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    default_detail = "This action violates a business rule."
    default_code = "domain_rule_violation"


class Conflict(exceptions.APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "The resource is in a conflicting state."
    default_code = "conflict"


def _flatten_details(detail, prefix: str = "") -> list[dict[str, str]]:
    """Turn DRF's nested error structure into a flat, client-friendly list."""
    details: list[dict[str, str]] = []

    if isinstance(detail, dict):
        for field, value in detail.items():
            path = f"{prefix}.{field}" if prefix else str(field)
            details.extend(_flatten_details(value, path))
    elif isinstance(detail, list):
        for index, value in enumerate(detail):
            # Index only matters for lists of objects, not lists of messages.
            path = prefix if isinstance(value, str) else f"{prefix}[{index}]"
            details.extend(_flatten_details(value, path))
    else:
        details.append({"field": prefix or "non_field", "issue": str(detail)})

    return details


def envelope_exception_handler(exc, context):
    request = context.get("request")
    request_id = getattr(request, "request_id", None)

    # Translate framework/database exceptions DRF does not handle natively.
    if isinstance(exc, Http404):
        exc = exceptions.NotFound()
    elif isinstance(exc, DjangoPermissionDenied):
        exc = exceptions.PermissionDenied()
    elif isinstance(exc, IntegrityError):
        logger.warning("integrity error", exc_info=exc, extra={"request_id": request_id})
        exc = Conflict("The request conflicts with existing data.")

    response = drf_exception_handler(exc, context)
    if response is None:
        # Unhandled: let Django's 500 path handle it so the error is reported,
        # rather than silently returning a tidy envelope for a real bug.
        return None

    code = getattr(exc, "default_code", None) or _CODE_BY_STATUS.get(
        response.status_code, "error"
    )
    detail = getattr(exc, "detail", response.data)
    details = _flatten_details(detail)
    message = details[0]["issue"] if len(details) == 1 else _CODE_BY_STATUS.get(
        response.status_code, "Request failed."
    )

    if response.status_code >= 500:
        logger.error("server error", exc_info=exc, extra={"request_id": request_id})

    return Response(
        {
            "error": {
                "code": code,
                "message": message,
                "details": details,
                "request_id": request_id,
            }
        },
        status=response.status_code,
        headers=getattr(response, "headers", None),
    )
