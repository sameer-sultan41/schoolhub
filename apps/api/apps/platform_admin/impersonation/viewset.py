"""The console's impersonation routes (§16), under ``/api/v1/platform/``.

- ``POST tenants/{tenant_pk}:impersonate`` and ``GET tenants/{tenant_pk}/users`` bind that one
  school (`PlatformTenantNestedMixin`).
- ``DELETE impersonation-grants/{id}`` reads the platform-scope grant only.

``:impersonate`` takes no ``Idempotency-Key``: a replay record would store the raw handoff code.
A retry makes a new grant, which releases the one before it.
"""

from __future__ import annotations

from django.db.models import Prefetch, Q
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import exceptions, mixins
from rest_framework.request import Request
from rest_framework.response import Response

from apps.platform_admin.impersonation import events, services
from apps.platform_admin.impersonation.serializers import (
    ImpersonateRequestSerializer,
    ImpersonationGrantStartedSerializer,
    PlatformTenantUserSerializer,
)
from apps.platform_admin.models import ImpersonationEnd, ImpersonationGrant
from core.api.pagination import PageNumberPagination
from core.api.platform import PlatformTenantNestedMixin, PlatformViewSet
from core.api.viewsets import ActionResponse
from core.rbac.account_links import account_link
from core.rbac.models import User, UserRole

KEY = services.IMPERSONATE_KEY


class TenantImpersonationViewSet(PlatformTenantNestedMixin, PlatformViewSet):
    """`POST /platform/tenants/{tenant_pk}:impersonate`."""

    required_permission = KEY
    required_permission_map = {"impersonate": KEY}
    http_method_names = ["post", "options"]

    @extend_schema(
        summary="Impersonate a school user: a time-boxed grant and its one-time handoff link",
        request=ImpersonateRequestSerializer,
        responses={
            201: ImpersonationGrantStartedSerializer,
            409: OpenApiResponse(description="conflict: the school is not operational."),
            422: OpenApiResponse(
                description="domain_rule_violation: a duration out of range, or a user who is "
                "not an active, non-platform user of this school."
            ),
        },
    )
    def impersonate(self, request: Request, tenant_pk=None) -> Response:
        payload = ImpersonateRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        reason = payload.validated_data["reason"].strip()
        if not reason:
            raise exceptions.ValidationError({"reason": ["A reason is required."]})

        started = services.start(
            tenant=request.tenant,
            operator_id=request.user.pk,
            target_user_id=payload.validated_data["user_id"],
            reason=reason,
            duration_minutes=payload.validated_data["duration_minutes"],
        )
        for previous in started.superseded:
            events.ended(previous, request=request)
        events.granted(request, started.grant)
        handoff_url = account_link(request.tenant, services.HANDOFF_PATH, code=started.code)
        data = ImpersonationGrantStartedSerializer(
            {
                "grant_id": started.grant.pk,
                "expires_at": started.grant.expires_at,
                "handoff_url": handoff_url,
            }
        ).data
        return ActionResponse.ok(
            data,
            message="Impersonation granted.",
            status=201,
        )


class TenantUserViewSet(PlatformTenantNestedMixin, mixins.ListModelMixin, PlatformViewSet):
    """`GET /platform/tenants/{tenant_pk}/users?q=&role=`: whom the console may impersonate.

    The school's active, non-platform logins, with their live roles' slugs. ``q`` matches the
    name, email or username; ``role`` a role slug.
    """

    serializer_class = PlatformTenantUserSerializer
    pagination_class = PageNumberPagination
    # Filtered by hand below; the default backends would advertise `ordering` on a list that
    # offers none.
    filter_backends: list = []
    required_permission = KEY
    http_method_names = ["get", "head", "options"]

    def get_queryset(self):
        live_roles = UserRole.objects.filter(
            deleted_at__isnull=True, role__deleted_at__isnull=True
        ).select_related("role")
        users = (
            User.objects.filter(
                tenant_id=self.request.tenant.pk,
                is_platform=False,
                is_active=True,
                deleted_at__isnull=True,
            )
            .prefetch_related(Prefetch("user_roles", queryset=live_roles, to_attr="live_roles"))
            .order_by("first_name", "last_name", "id")
        )
        query = self.request.query_params.get("q", "").strip()
        if query:
            users = users.filter(
                Q(first_name__icontains=query)
                | Q(last_name__icontains=query)
                | Q(email__icontains=query)
                | Q(username__icontains=query)
            )
        role = self.request.query_params.get("role", "").strip()
        if role:
            users = users.filter(
                user_roles__in=UserRole.objects.filter(
                    deleted_at__isnull=True, role__deleted_at__isnull=True, role__slug=role
                )
            ).distinct()
        return users

    @extend_schema(
        summary="The school's users the console may impersonate",
        parameters=[
            OpenApiParameter("q", str, description="Part of a name, email or username."),
            OpenApiParameter("role", str, description="A role slug the user holds."),
        ],
    )
    def list(self, request: Request, *args, **kwargs) -> Response:
        return super().list(request, *args, **kwargs)


class ImpersonationGrantViewSet(PlatformViewSet):
    """`DELETE /platform/impersonation-grants/{id}`: the holder releases, a super admin revokes.

    Anyone else gets a 404, as for a grant that does not exist. Ending an ended grant is a 204.
    """

    required_permission = KEY
    required_permission_map = {"destroy": KEY}
    http_method_names = ["delete", "options"]

    @extend_schema(summary="Release or revoke an impersonation grant", responses={204: None})
    def destroy(self, request: Request, pk=None) -> Response:
        grant = ImpersonationGrant.objects.filter(pk=pk).first()
        if grant is None:
            raise exceptions.NotFound()
        if grant.granted_to_id == request.user.pk:
            reason = ImpersonationEnd.RELEASED
        elif services.may_revoke_others(request.user.pk):
            reason = ImpersonationEnd.REVOKED
        else:
            raise exceptions.NotFound()
        ended = services.end(grant.pk, reason=reason)
        if ended is not None:
            events.ended(ended, request=request)
        return Response(status=204)
