"""The anonymous public contact-form POST (`POST /api/v1/public/contact-submissions`).

Anonymous, so no machine token: the school comes from `X-Tenant-Slug` and, when the browser
sends `Origin`, that host must belong to the same school (a consistency check, not
authentication: the throttles and the honeypot are the spam controls). A missing `Origin`
is allowed for mobile clients (Invariant 7). Field rules live in `create_contact_submission`.
"""

from __future__ import annotations

from urllib.parse import urlparse
from uuid import UUID

from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework.exceptions import NotFound
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.website_cms.contact_submissions.services import create_contact_submission
from apps.website_cms.errors import violation
from apps.website_cms.hosts import resolve_host
from apps.website_cms.models import WebsitePage
from apps.website_cms.public.serializers import (
    ContactReceivedSerializer,
    PublicContactSubmissionSerializer,
)
from apps.website_cms.public.views import bound_website_tenant
from core.api.throttling import PublicFormTenantThrottle, PublicFormThrottle
from core.idempotency.services import replay_or_execute
from core.rbac.machine import client_ip
from core.tenancy.models import Tenant

TENANT_SLUG_HEADER = "X-Tenant-Slug"
RECEIVED = {"status": "received"}


def _tenant_for(request: Request) -> Tenant:
    """The school `X-Tenant-Slug` names, 404 if unknown or if `Origin` is another school's."""
    slug = request.headers.get(TENANT_SLUG_HEADER, "").strip().lower()
    tenant = Tenant.objects.filter(slug=slug, deleted_at__isnull=True).first() if slug else None
    if tenant is None:
        raise NotFound
    origin = request.headers.get("Origin")
    if origin is not None:
        origin_tenant = resolve_host(urlparse(origin).hostname or "")
        if origin_tenant is None or origin_tenant.pk != tenant.pk:
            raise NotFound
    return tenant


class PublicContactSubmissionView(APIView):
    """Store a contact message for a live site and notify its staff; 404 for any refusal."""

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [PublicFormThrottle, PublicFormTenantThrottle]

    @extend_schema(
        operation_id="public_contact_submissions_create",
        request=PublicContactSubmissionSerializer,
        parameters=[
            OpenApiParameter(
                TENANT_SLUG_HEADER,
                str,
                location=OpenApiParameter.HEADER,
                required=True,
                description="The school's slug.",
            ),
            OpenApiParameter(
                "Idempotency-Key",
                str,
                location=OpenApiParameter.HEADER,
                required=False,
                description="A retry with the same key replays the first response.",
            ),
        ],
        responses={
            201: ContactReceivedSerializer,
            404: OpenApiResponse(
                description="No live site for this school (the same for every refusal)."
            ),
            422: OpenApiResponse(description="A field broke a rule; keyed by field."),
            429: OpenApiResponse(description="Too many submissions."),
        },
        auth=[],
    )
    def post(self, request: Request) -> Response:
        serializer = PublicContactSubmissionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        tenant = _tenant_for(request)
        with bound_website_tenant(tenant):
            if data.pop("company_website", ""):
                # Honeypot: a bot filled the hidden field; look like success, store nothing.
                return Response(RECEIVED, status=201)
            source_page_id: UUID | None = data.pop("source_page_id", None)
            ip = client_ip(request)

            def execute() -> Response:
                page = None
                if source_page_id is not None:
                    page = WebsitePage.objects.alive().filter(pk=source_page_id).first()
                    if page is None:
                        raise violation(
                            "source_page", "invalid_source_page", "the page is not published."
                        )
                create_contact_submission(tenant, data, ip, page)
                return Response(RECEIVED, status=201)

            return replay_or_execute(
                tenant_id=tenant.pk,
                key=request.headers.get("Idempotency-Key"),
                endpoint="public-contact-submissions:create",
                request_data=request.data,
                execute=execute,
            )
