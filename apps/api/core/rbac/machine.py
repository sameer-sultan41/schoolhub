"""Machine clients: platform services that call the API with a static bearer token.

The website renderer is the first (plan decision 1). A machine client is not a user: it has
no tenant, no roles and no `pk`, only the scopes `MACHINE_CLIENTS` grants it. Its scopes live
in `MACHINE_SCOPES`, never in the role permission registry, so no role can be granted one.

These classes are set per view, never in `DEFAULT_AUTHENTICATION_CLASSES`: a machine token
must not authenticate on any staff route, and a staff JWT must not on a machine route.
"""

from __future__ import annotations

import hashlib
import hmac
from collections.abc import Mapping
from dataclasses import dataclass

from django.conf import settings
from drf_spectacular.extensions import OpenApiAuthenticationExtension
from rest_framework import exceptions
from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from core.tenancy.hosts import normalise_host

#: The website renderer's read scope over published public content (plan decision 1).
WEBSITE_PUBLIC_CONTENT_SCOPE = "website.public-content.view"

#: Every scope a machine client may hold. A machine-guarded view's scope must be listed here.
MACHINE_SCOPES = frozenset({WEBSITE_PUBLIC_CONTENT_SCOPE})

_KEYWORD = b"bearer"
_INVALID = "Invalid machine token."


@dataclass(frozen=True)
class MachinePrincipal:
    """`request.user` for a machine client. No tenant and no `pk`, so no tenant binds."""

    client: str
    scopes: frozenset[str]
    is_authenticated: bool = True
    is_anonymous: bool = False
    pk: None = None
    tenant_id: None = None


def _client_tokens(config: Mapping[str, object]) -> list[str]:
    """The client's live tokens, newest first; an empty setting yields none (fail closed)."""
    raw = getattr(settings, str(config.get("tokens_setting", "")), "")
    values = raw.split(",") if isinstance(raw, str) else list(raw or [])
    return [token.strip() for token in values if isinstance(token, str) and token.strip()]


def _client_scopes(config: Mapping[str, object]) -> frozenset[str]:
    scopes = config.get("scopes", [])
    if not isinstance(scopes, list | tuple | frozenset | set):
        return frozenset()
    return frozenset(str(scope) for scope in scopes) & MACHINE_SCOPES


def _match(token: bytes) -> MachinePrincipal | None:
    clients: Mapping[str, Mapping[str, object]] = settings.MACHINE_CLIENTS
    matched: MachinePrincipal | None = None
    for client, config in clients.items():
        for candidate in _client_tokens(config):
            # Compare against every token, so timing does not reveal which one matched.
            if hmac.compare_digest(candidate.encode(), token) and matched is None:
                matched = MachinePrincipal(client=client, scopes=_client_scopes(config))
    return matched


class MachineTokenAuthentication(BaseAuthentication):
    """`Authorization: Bearer <token>`, accepted when it is any token of a configured client."""

    def authenticate(self, request: Request) -> tuple[MachinePrincipal, None] | None:
        parts = get_authorization_header(request).split()
        if not parts or parts[0].lower() != _KEYWORD:
            return None
        if len(parts) != 2:
            raise exceptions.AuthenticationFailed(_INVALID)
        principal = _match(parts[1])
        if principal is None:
            raise exceptions.AuthenticationFailed(_INVALID)
        return principal, None

    def authenticate_header(self, request: Request) -> str:
        # Non-empty, so DRF answers a missing or bad token with 401, not 403.
        return 'Bearer realm="api"'


class MachineTokenScheme(OpenApiAuthenticationExtension):
    """Names the machine token in the OpenAPI schema (drf-spectacular's documented hook)."""

    target_class = MachineTokenAuthentication
    name = "machineToken"

    def get_security_definition(self, auto_schema: object) -> dict[str, str]:
        return {"type": "http", "scheme": "bearer"}


class HasMachineScope(BasePermission):
    """Allows a machine client holding `view.required_machine_scope`. Fails closed."""

    def has_permission(self, request: Request, view: APIView) -> bool:
        scope = getattr(view, "required_machine_scope", None)
        user = request.user
        return (
            isinstance(user, MachinePrincipal) and scope in MACHINE_SCOPES and scope in user.scopes
        )


class MachineClientThrottle(SimpleRateThrottle):
    """Per (client, `host`) bucket for machine reads (plan decision 2a, scope `machine_client`).

    Not per IP and not per user: the renderer serves every tenant from a few addresses and has
    no `pk`, so either key would let one busy school starve the rest.
    """

    scope = "machine_client"

    def get_cache_key(self, request: Request, view: APIView) -> str | None:
        user = request.user
        if not isinstance(user, MachinePrincipal):
            return None
        # Canonical host, so `A.test:3001` and `a.test` share a bucket; garbage shares one too.
        host = normalise_host(str(request.query_params.get("host", ""))) or "-"
        digest = hashlib.sha256(host.encode()).hexdigest()[:32]
        return self.cache_format % {"scope": self.scope, "ident": f"{user.client}:{digest}"}
