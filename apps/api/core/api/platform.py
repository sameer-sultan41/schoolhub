"""Base classes for the platform console's endpoints, under ``/api/v1/platform/`` (ADR-0036).

The console serves platform users only, and it reads a school's data only with that one
school bound, so the database's RLS boundary holds for platform requests as well.
"""

from __future__ import annotations

from collections.abc import Callable

from django.core.exceptions import ValidationError
from rest_framework import exceptions, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from core.idempotency.services import replay_or_execute
from core.rbac.permissions import HasPermissionKey, IsPlatformPrincipal
from core.tenancy.context import bind_tenant, unbind_tenant
from core.tenancy.models import Tenant


class PlatformViewSet(viewsets.GenericViewSet):
    """A platform console viewset. Declare ``required_permission`` and ``required_permission_map``.

    Gates, in order:
    - ``IsAuthenticated``: anonymous callers get a 401.
    - ``IsPlatformPrincipal``: a tenant principal gets a 404, and a platform token without
      ``"otp"`` in its ``amr`` gets a 403 ``mfa_required``.
    - ``HasPermissionKey``: a platform user without the route's key gets a 403.

    No tenant is bound, so a route here reads platform tables only (``tenants``, ``plans``).
    One that reads or writes a school's own rows is nested under its tenant through
    `PlatformTenantNestedMixin`, which binds that one school.
    """

    permission_classes = [IsAuthenticated, IsPlatformPrincipal, HasPermissionKey]


class PlatformTenantNestedMixin:
    """Binds the target school of a ``.../tenants/<tenant_pk>/...`` route for the whole request.

    **One target tenant per platform request.** ``initial()`` loads the tenant named by the
    ``tenant_pk`` URL kwarg (404 if there is none), binds it the way
    `core.api.viewsets.TenantScopedViewSetMixin` binds the caller's own, and sets
    ``request.tenant``, so `record_audit` attributes each row to it. Under
    ``ATOMIC_REQUESTS`` the binding's ``SET LOCAL`` lasts the whole request: reads and writes
    alike see that school's rows and no other's.

    The tenant is loaded only after authentication and the permission checks have passed, so
    an unknown id answers 401, 404 or 403 exactly as a known one does, and is no oracle.

    List it before `PlatformViewSet`: ``class X(PlatformTenantNestedMixin, PlatformViewSet)``.
    """

    tenant_url_kwarg = "tenant_pk"
    request: Request  # set by DRF's dispatch

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        tenant = self._target_tenant(kwargs.get(self.tenant_url_kwarg))
        request.tenant = tenant
        # DRF wraps the Django request; module code and audit reach for either.
        request._request.tenant = tenant
        self._tenant_token = bind_tenant(tenant.pk)

    def finalize_response(self, request, response, *args, **kwargs):
        token = getattr(self, "_tenant_token", None)
        if token is not None:
            unbind_tenant(token)
            self._tenant_token = None
        return super().finalize_response(request, response, *args, **kwargs)

    def run_idempotent(self, endpoint: str, execute: Callable[[], Response]) -> Response:
        """Run ``execute`` once per ``Idempotency-Key``, the record owned by the target tenant."""
        request = self.request
        return replay_or_execute(
            tenant_id=request.tenant.pk,
            key=request.headers.get("Idempotency-Key"),
            endpoint=endpoint,
            request_data=request.data,
            execute=execute,
        )

    @staticmethod
    def _target_tenant(tenant_pk) -> Tenant:
        try:
            tenant = Tenant.objects.filter(pk=tenant_pk, deleted_at__isnull=True).first()
        except ValueError, ValidationError:
            tenant = None
        if tenant is None:
            raise exceptions.NotFound()
        return tenant
