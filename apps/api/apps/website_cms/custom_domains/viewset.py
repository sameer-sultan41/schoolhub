"""`CustomDomainViewSet` — `/custom-domains` (module doc §16, §7.2)."""

from __future__ import annotations

from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework_simplejwt.authentication import JWTAuthentication

from apps.website_cms.custom_domains import services
from apps.website_cms.custom_domains.serializers import (
    CustomDomainCreateSerializer,
    CustomDomainSerializer,
    CustomDomainUpdateSerializer,
)
from apps.website_cms.models import CustomDomain, CustomDomainStatus
from apps.website_cms.views import FEATURE, STAFF_PERMISSIONS
from core.api.exceptions import Conflict
from core.api.pagination import PageNumberPagination
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit
from core.rbac.permissions import AnyOf
from core.tenancy.context import tenant_atomic

#: §4 has no view key for domains: anyone who may add or verify one may list them (decision 13).
DOMAIN_READ = AnyOf("website.custom-domain.create", "website.custom-domain.update")


class CustomDomainViewSet(TenantScopedViewSetMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    """`custom-domains`: claim, verify, choose the primary, remove. JWT only."""

    authentication_classes = [JWTAuthentication]
    permission_classes = STAFF_PERMISSIONS
    queryset = CustomDomain.objects
    serializer_class = CustomDomainSerializer
    pagination_class = PageNumberPagination
    ordering_fields = ["domain", "status", "created_at"]
    # CustomDomain.Meta.ordering; the view repeats it because DRF reads the view's default.
    ordering = ["domain", "id"]
    scope_campus_field = None
    required_feature = FEATURE
    required_permission = DOMAIN_READ
    required_permission_map = {
        "create": "website.custom-domain.create",
        "partial_update": "website.custom-domain.update",
        "verify": "website.custom-domain.update",
        "destroy": "website.custom-domain.delete",
    }
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def initial(self, request: Request, *args: object, **kwargs: object) -> None:
        """Run the permission checks in a transaction on the non-atomic `:verify` route.

        `:verify` opts out of ATOMIC_REQUESTS (urls.py) so DNS runs with no transaction
        open; the tenant binding is a `SET LOCAL`, so the checks get a transaction of their
        own (L68, as `FeeInvoiceViewSet` does).
        """
        if transaction.get_connection().in_atomic_block:
            super().initial(request, *args, **kwargs)
            return
        with transaction.atomic():
            super().initial(request, *args, **kwargs)

    @extend_schema(request=CustomDomainCreateSerializer, responses={201: CustomDomainSerializer})
    def create(self, request: Request, *args: object, **kwargs: object) -> Response:
        serializer = CustomDomainCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        domain = services.create_custom_domain(
            request.tenant, serializer.validated_data["domain"], request.user.pk
        )
        data = CustomDomainSerializer(domain).data
        record_audit(request, "create", domain, after=data)
        return ActionResponse.ok(data, message="Domain added.", status=201)

    @extend_schema(request=CustomDomainUpdateSerializer, responses={200: CustomDomainSerializer})
    def partial_update(self, request: Request, *args: object, **kwargs: object) -> Response:
        domain = self.get_object()
        serializer = CustomDomainUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        before = CustomDomainSerializer(domain).data
        domain = services.set_primary(
            request.tenant, domain.pk, serializer.validated_data["is_primary"], request.user.pk
        )
        data = CustomDomainSerializer(domain).data
        record_audit(request, "update", domain, before=before, after=data)
        return ActionResponse.ok(data, message="Domain updated.")

    @extend_schema(responses={204: None})
    def destroy(self, request: Request, *args: object, **kwargs: object) -> Response:
        domain = self.get_object()
        before = CustomDomainSerializer(domain).data
        services.delete_custom_domain(request.tenant, domain.pk, request.user.pk)
        record_audit(request, "delete", domain, before=before)
        return Response(status=204)

    @extend_schema(request=None, responses={200: CustomDomainSerializer})
    def verify(self, request: Request, pk: str) -> Response:
        """`POST /custom-domains/{id}:verify`: check DNS now and activate on success.

        Not wrapped in ATOMIC_REQUESTS: each database step opens its own `tenant_atomic`
        and the DNS lookup runs between them (ADR-0034).
        """
        tenant = request.tenant
        with tenant_atomic(tenant.pk):
            domain = self.get_object()
            before = CustomDomainSerializer(domain).data
        try:
            domain = services.verify_custom_domain(tenant, domain.pk, request.user.pk)
        except Conflict:
            # The claim was stored `failed` before the 409; the attempt is still audited.
            with tenant_atomic(tenant.pk):
                after = {"status": CustomDomainStatus.FAILED, "reason": "domain_taken"}
                record_audit(request, "verify", domain, before=before, after=after)
            raise
        with tenant_atomic(tenant.pk):
            data = CustomDomainSerializer(domain).data
            record_audit(request, "verify", domain, before=before, after=data)
        active = data["status"] == CustomDomainStatus.ACTIVE
        message = "Domain verified." if active else "Verification failed."
        return ActionResponse.ok(data, message=message)
