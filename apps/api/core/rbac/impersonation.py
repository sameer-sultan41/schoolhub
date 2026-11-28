"""Impersonation sessions, as core sees them (ADR-0037).

An operator's impersonation token is an ordinary access token of the school user, with
``grant_id``, ``act`` (RFC 8693: the operator) and ``amr=["impersonation"]``. Core cannot
read the grant: ``apps.platform_admin`` owns it and registers the hooks here from
``AppConfig.ready()`` (ADR-0013). `core.rbac.authentication.ImpersonationAwareJWTAuthentication`
asks the checker on every request; no registered checker refuses the token (fail closed).
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from contextvars import ContextVar, Token
from dataclasses import dataclass
from datetime import datetime

from rest_framework import permissions, status
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.request import Request

from core.api.exceptions import CodedAPIException

IMPERSONATION_AMR = "impersonation"
GRANT_CLAIM = "grant_id"
ACTOR_CLAIM = "act"


class ImpersonationEnded(CodedAPIException, AuthenticationFailed):
    """The token's grant was released, expired or revoked, or its holder may no longer use it.

    An ``AuthenticationFailed``, so DRF adds ``WWW-Authenticate`` to the 401 (RFC 9110 §15.5.2).
    """

    status_code = status.HTTP_401_UNAUTHORIZED
    default_detail = "This support session has ended."
    default_code = "impersonation_ended"


class ImpersonationForbidden(CodedAPIException):
    """An account change (password, second factor) refused under impersonation."""

    status_code = status.HTTP_403_FORBIDDEN
    default_detail = "This cannot be done while impersonating a user."
    default_code = "impersonation_forbidden"


@dataclass(frozen=True)
class LiveGrant:
    """A grant the checker found live, and what `/auth/me` shows of it."""

    grant_id: uuid.UUID
    operator_id: uuid.UUID
    operator_name: str
    expires_at: datetime


# `check(grant_id, *, target_user_id, operator_id)`: the live grant, or None.
type GrantChecker = Callable[..., LiveGrant | None]
# `end(grant_id, *, request)`: release the grant the session runs under.
type GrantEnder = Callable[..., None]


@dataclass(frozen=True)
class _Hooks:
    check: GrantChecker
    end: GrantEnder


_hooks: _Hooks | None = None

# The grant the current request runs under, for the log formatter: bound by the authenticator,
# scoped per request by `core.rbac.middleware.ImpersonationLogMiddleware`.
_current_impersonation: ContextVar[LiveGrant | None] = ContextVar(
    "current_impersonation", default=None
)


def bind_impersonation(live: LiveGrant | None) -> Token[LiveGrant | None]:
    return _current_impersonation.set(live)


def unbind_impersonation(token: Token[LiveGrant | None]) -> None:
    _current_impersonation.reset(token)


def get_current_impersonation() -> LiveGrant | None:
    return _current_impersonation.get()


def register_impersonation_hooks(*, check: GrantChecker, end: GrantEnder) -> None:
    """Called once, by ``apps.platform_admin.hooks``."""
    global _hooks
    _hooks = _Hooks(check=check, end=end)


def check_grant(
    grant_id: uuid.UUID, *, target_user_id: uuid.UUID, operator_id: uuid.UUID
) -> LiveGrant | None:
    """The live grant, or None; always None while no checker is registered (fail closed)."""
    if _hooks is None:
        return None
    return _hooks.check(grant_id, target_user_id=target_user_id, operator_id=operator_id)


def end_impersonation(request: Request) -> None:
    """Release the grant the request's session runs under (logout under impersonation)."""
    grant = getattr(request, "impersonation", None)
    if grant is None or _hooks is None:
        return
    _hooks.end(grant.grant_id, request=request)


def is_impersonated(request: Request) -> bool:
    if getattr(request, "impersonation", None) is not None:
        return True
    token = getattr(request, "auth", None)
    return token is not None and hasattr(token, "get") and token.get(GRANT_CLAIM) is not None


class RefuseImpersonation(permissions.BasePermission):
    """403 ``impersonation_forbidden`` for an impersonated request: the account's own changes.

    Listed right after ``IsAuthenticated``, so it answers before a platform-only gate's 404.
    """

    def has_permission(self, request, view) -> bool:
        if is_impersonated(request):
            raise ImpersonationForbidden()
        return True
