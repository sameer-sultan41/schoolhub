"""The anonymous public contact-form POST (`POST /api/v1/public/contact-submissions`).

Anonymous, so no machine token: the school comes from `X-Tenant-Slug` and, when the browser
sends `Origin`, that host must belong to the same school (a consistency check, not
authentication: the throttles and the honeypot are the spam controls). A missing `Origin`
is allowed for mobile clients (Invariant 7). Field rules live in `create_contact_submission`.
"""

from __future__ import annotations

import io
from uuid import UUID

from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework.exceptions import (
    APIException,
    NotFound,
    ParseError,
    Throttled,
    UnsupportedMediaType,
)
from rest_framework.parsers import JSONParser
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.website_cms.constants import CONTACT_BODY_MAX_BYTES
from apps.website_cms.contact_submissions.services import create_contact_submission
from apps.website_cms.cors import origin_host
from apps.website_cms.errors import violation
from apps.website_cms.hosts import resolve_host
from apps.website_cms.models import WebsitePage
from apps.website_cms.public.serializers import (
    ContactReceivedSerializer,
    PublicContactSubmissionSerializer,
)
from apps.website_cms.public.views import bound_website_tenant
from core.api.client_ip import client_ip
from core.api.throttling import PublicFormTenantThrottle, PublicFormThrottle
from core.idempotency.models import IdempotencyRecord
from core.idempotency.services import replay_or_execute
from core.tenancy.models import Tenant

TENANT_SLUG_HEADER = "X-Tenant-Slug"
RECEIVED = {"status": "received"}
TOO_LARGE = f"The body is over {CONTACT_BODY_MAX_BYTES // 1024} KB."
IDEMPOTENCY_KEY_MAX = IdempotencyRecord._meta.get_field("key").max_length


class PayloadTooLarge(APIException):
    status_code = 413
    default_detail = "The request body is too large."
    default_code = "payload_too_large"


def _json_body(request: Request) -> dict:
    """The JSON object in the body, read at most `CONTACT_BODY_MAX_BYTES` + 1 bytes.

    A declared `Content-Length` over the cap is refused without reading; an absent or invalid
    one is still bounded by the read, so `request.data` never buffers an unbounded body.
    """
    if not (request.content_type or "").startswith("application/json"):
        raise UnsupportedMediaType(request.content_type or "")
    declared = request.META.get("CONTENT_LENGTH", "")
    if declared.isdigit() and int(declared) > CONTACT_BODY_MAX_BYTES:
        raise PayloadTooLarge
    raw = request.read(CONTACT_BODY_MAX_BYTES + 1)
    if len(raw) > CONTACT_BODY_MAX_BYTES:
        raise PayloadTooLarge
    data = JSONParser().parse(io.BytesIO(raw))
    if not isinstance(data, dict):
        raise ParseError("Expected a JSON object.")
    return data


def _tenant_for(request: Request) -> Tenant:
    """The school `X-Tenant-Slug` names, 404 if unknown or if `Origin` is another school's."""
    slug = request.headers.get(TENANT_SLUG_HEADER, "").strip().lower()
    tenant = Tenant.objects.filter(slug=slug, deleted_at__isnull=True).first() if slug else None
    if tenant is None:
        raise NotFound
    origin = request.headers.get("Origin")
    if origin is not None:
        origin_tenant = resolve_host(origin_host(origin) or "")
        if origin_tenant is None or origin_tenant.pk != tenant.pk:
            raise NotFound
    return tenant


class PublicContactSubmissionView(APIView):
    """Store a contact message for a live site and notify its staff; 404 for any refusal."""

    authentication_classes: list = []
    permission_classes = [AllowAny]
    parser_classes = [JSONParser]
    # The per-school bucket is checked in `post()`, after validation (see its docstring).
    throttle_classes = [PublicFormThrottle]

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
            413: OpenApiResponse(description=TOO_LARGE),
            415: OpenApiResponse(description="The body is not JSON."),
            404: OpenApiResponse(
                description="No live site for this school (the same for every refusal)."
            ),
            422: OpenApiResponse(description="A field broke a rule; keyed by field."),
            429: OpenApiResponse(description="Too many submissions."),
        },
        auth=[],
    )
    def post(self, request: Request) -> Response:
        # Header-only checks first: a bad slug or Origin is refused without parsing a body.
        tenant = _tenant_for(request)
        body = _json_body(request)
        key = request.headers.get("Idempotency-Key")
        if key is not None and len(key) > IDEMPOTENCY_KEY_MAX:
            raise violation(
                "idempotency_key",
                "invalid_idempotency_key",
                f"use at most {IDEMPOTENCY_KEY_MAX} characters.",
            )
        serializer = PublicContactSubmissionSerializer(data=body)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        with bound_website_tenant(tenant):
            if data.pop("company_website", ""):
                # Honeypot: a bot filled the hidden field; look like success, store nothing.
                return Response(RECEIVED, status=201)
            # Only a request that would store a message spends the school's hourly budget.
            tenant_throttle = PublicFormTenantThrottle()
            if not tenant_throttle.allow_request(request, self):
                raise Throttled(wait=tenant_throttle.wait())
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
                key=key,
                endpoint="public-contact-submissions:create",
                request_data=body,
                execute=execute,
            )
