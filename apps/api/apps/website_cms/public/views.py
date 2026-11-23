"""The renderer's read-only public content API (`/api/v1/public/`, plan decisions 1, 2, 2a, 9).

Every view authenticates the platform machine client, never a user: no JWT is accepted, and no
view writes or calls `record_audit` (the principal has no user row to point at). The tenant is
never asserted by the caller; each read resolves it from `?host=` and binds it for RLS.
"""

from __future__ import annotations

import contextlib
from collections.abc import Iterator
from contextlib import AbstractContextManager
from uuid import UUID

from django.core.signing import BadSignature
from django.utils.cache import patch_cache_control, patch_vary_headers
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework.exceptions import NotFound
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import BaseThrottle
from rest_framework.views import APIView

from apps.website_cms.constants import PUBLIC_LIST_MAX, WebsiteStatus
from apps.website_cms.features import FEATURE
from apps.website_cms.hosts import resolve_host, website_status
from apps.website_cms.preview import read_preview_token
from apps.website_cms.public import services
from apps.website_cms.public.serializers import (
    PublicPageSerializer,
    PublicSitemapEntrySerializer,
    PublicSiteSerializer,
    PublicTenantSerializer,
)
from core.api.throttling import PublicPreviewThrottle
from core.rbac.machine import (
    WEBSITE_PUBLIC_CONTENT_SCOPE,
    HasMachineScope,
    MachineClientThrottle,
    MachineTokenAuthentication,
)
from core.tenancy.context import tenant_atomic
from core.tenancy.features import is_feature_enabled
from core.tenancy.models import Tenant, TenantStatus

#: The header a draft page's preview token travels in; never a query parameter (SEC-57).
PREVIEW_HEADER = "X-Preview-Token"

HOST_PARAMETER = OpenApiParameter(
    "host", str, required=True, description="The site's host, as the visitor's browser sent it."
)
PREVIEW_PARAMETER = OpenApiParameter(
    PREVIEW_HEADER,
    str,
    location=OpenApiParameter.HEADER,
    required=False,
    description="A page preview token for this host's school: reads before the site is live.",
)
PAGE_SIZE_PARAMETER = OpenApiParameter(
    "page_size",
    int,
    required=False,
    description=f"Rows to return, 1 to {PUBLIC_LIST_MAX} (the default and the cap).",
)
NOT_FOUND = OpenApiResponse(description="No live site, page or tenant answers on this host.")


@contextlib.contextmanager
def bound_website_tenant(tenant: Tenant, *, require_live: bool = True) -> Iterator[Tenant]:
    """Yield `tenant` bound with `tenant_atomic`, or raise 404.

    404 unless the tenant is operational (`Tenant.is_operational`, the rule
    `operational_tenant` applies), `module.website` is on for it and, when `require_live`,
    its site is live. Each refusal is the same 404, so a caller learns nothing about why.
    """
    if not tenant.is_operational:
        raise NotFound
    with tenant_atomic(tenant.pk):
        if not is_feature_enabled(FEATURE, tenant_id=tenant.pk):
            raise NotFound
        if require_live and website_status(tenant) != WebsiteStatus.LIVE:
            raise NotFound
        yield tenant


class PublicContentView(APIView):
    """Base of every machine-client read: auth, scope and the per-host throttle (decision 2a).

    The throttle replaces the defaults, whose `UserRateThrottle` would key every renderer read
    on a principal with no `pk`.
    """

    authentication_classes = [MachineTokenAuthentication]
    permission_classes = [HasMachineScope]
    throttle_classes = [MachineClientThrottle]
    required_machine_scope = WEBSITE_PUBLIC_CONTENT_SCOPE
    #: A view that reads `X-Preview-Token` also counts those reads per client IP.
    accepts_preview = False

    def get_throttles(self) -> list[BaseThrottle]:
        throttles = list(super().get_throttles())
        if self.accepts_preview and self.request.headers.get(PREVIEW_HEADER):
            throttles.append(PublicPreviewThrottle())
        return throttles

    @staticmethod
    def list_limit(request: Request) -> int:
        """`?page_size=` bounded to 1..`PUBLIC_LIST_MAX`; absent or not a number is the cap."""
        try:
            wanted = int(request.query_params.get("page_size", PUBLIC_LIST_MAX))
        except TypeError, ValueError:
            return PUBLIC_LIST_MAX
        return max(1, min(wanted, PUBLIC_LIST_MAX))

    def get_tenant(self, request: Request) -> Tenant:
        """The non-deleted tenant `?host=` names, or 404."""
        tenant = resolve_host(str(request.query_params.get("host", "")))
        if tenant is None:
            raise NotFound
        return tenant

    def bound(self, tenant: Tenant, *, require_live: bool = True) -> AbstractContextManager[Tenant]:
        """`bound_website_tenant`: yield `tenant` bound with `tenant_atomic`, or raise 404."""
        return bound_website_tenant(tenant, require_live=require_live)

    def preview_page_id(self, request: Request, tenant: Tenant) -> UUID | None:
        """The page a `X-Preview-Token` header names, `None` without one; 404 if it is bad.

        Only the header counts (SEC-57). An expired or tampered token, or one for another
        school, is 404, so the renderer's `/api/preview` can trust the status code.
        """
        token = request.headers.get(PREVIEW_HEADER, "")
        if not token:
            return None
        try:
            tenant_id, page_id = read_preview_token(token)
        except BadSignature as exc:  # SignatureExpired is a BadSignature
            raise NotFound from exc
        if tenant_id != tenant.pk:
            raise NotFound
        return page_id

    @staticmethod
    def mark_preview(response: Response, *, preview: bool) -> Response:
        """Mark a response a preview token can change: never cached when it did."""
        patch_vary_headers(response, [PREVIEW_HEADER])
        if preview:
            patch_cache_control(response, no_store=True)
        return response


class PublicTenantByHostView(PublicContentView):
    """`GET /public/tenants/by-host?host=`: who the host belongs to and the state of its site.

    The exception to "404 unless live": a suspended school answers 200 with its `status`, so
    the renderer shows a neutral notice, and a site that is off, unpublished or in maintenance
    answers with its `website_status`; either way only identity, branding and state are sent.
    A provisioning, deprovisioned or deleted school, or an unknown host, is 404.
    """

    @extend_schema(
        operation_id="public_tenants_by_host",
        parameters=[HOST_PARAMETER],
        responses={200: PublicTenantSerializer, 404: NOT_FOUND},
    )
    def get(self, request: Request) -> Response:
        tenant = self.get_tenant(request)
        if not (tenant.is_operational or tenant.status == TenantStatus.SUSPENDED):
            raise NotFound
        with tenant_atomic(tenant.pk):
            status = (
                website_status(tenant)
                if is_feature_enabled(FEATURE, tenant_id=tenant.pk)
                else WebsiteStatus.UNPUBLISHED
            )
            data = services.read_tenant(tenant, status)
        return Response(PublicTenantSerializer(data).data)


class PublicSiteView(PublicContentView):
    """`GET /public/site?host=`: theme, navigation, header/footer, social links and site SEO.

    A valid preview token for this school reads it before the site is live (decision 9).
    """

    accepts_preview = True

    @extend_schema(
        operation_id="public_site",
        parameters=[HOST_PARAMETER, PREVIEW_PARAMETER],
        responses={200: PublicSiteSerializer, 404: NOT_FOUND},
    )
    def get(self, request: Request) -> Response:
        tenant = self.get_tenant(request)
        preview = self.preview_page_id(request, tenant) is not None
        with self.bound(tenant, require_live=not preview):
            data = services.read_site(tenant)
        return self.mark_preview(Response(PublicSiteSerializer(data).data), preview=preview)


class PublicPageView(PublicContentView):
    """`GET /public/pages?host=&slug=`: a published page with its visible sections, in order.

    An empty slug is the homepage, which answers at `/` only. A draft is read only under a
    preview token in the `X-Preview-Token` header naming this tenant and this page (decision 9);
    then `slug` is optional, the site need not be live, and the response is never cached.
    """

    accepts_preview = True

    @extend_schema(
        operation_id="public_page",
        parameters=[
            HOST_PARAMETER,
            OpenApiParameter(
                "slug",
                str,
                required=False,
                description="Empty for the homepage. Under a preview token, omit it to read the "
                "token's page.",
            ),
            PREVIEW_PARAMETER,
        ],
        responses={200: PublicPageSerializer, 404: NOT_FOUND},
    )
    def get(self, request: Request) -> Response:
        tenant = self.get_tenant(request)
        preview_page_id = self.preview_page_id(request, tenant)
        raw_slug = request.query_params.get("slug")
        slug = None if raw_slug is None else str(raw_slug)
        with self.bound(tenant, require_live=preview_page_id is None):
            data = services.read_page(tenant, slug, preview_page_id=preview_page_id)
        if data is None:
            raise NotFound
        response = Response(PublicPageSerializer(data).data)
        return self.mark_preview(response, preview=preview_page_id is not None)


class PublicSitemapView(PublicContentView):
    """`GET /public/sitemap?host=`: every published, indexable path of the site."""

    @extend_schema(
        operation_id="public_sitemap",
        parameters=[HOST_PARAMETER],
        responses={200: PublicSitemapEntrySerializer(many=True), 404: NOT_FOUND},
    )
    def get(self, request: Request) -> Response:
        with self.bound(self.get_tenant(request)):
            data = services.read_sitemap()
        return Response(PublicSitemapEntrySerializer(data, many=True).data)
