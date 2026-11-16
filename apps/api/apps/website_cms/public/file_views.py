"""The anonymous public file redirect (plan decision 4).

`GET /api/v1/public/files/{tenant_id}/{file_id}` answers 302 to a short-lived presigned link for
a file that published website content still references. It is anonymous (a browser or image
optimiser follows it), so it has no machine token, writes nothing and records no audit row.
"""

from __future__ import annotations

from uuid import UUID

from django.http import HttpResponseRedirect
from django.utils.cache import patch_cache_control
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework.exceptions import NotFound
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.views import APIView

from apps.website_cms.constants import PUBLIC_FILE_CACHE_SECONDS
from core.api.throttling import PublicFileThrottle
from core.files.models import File, FileStatus, FileVisibility
from core.files.services import get_display_url
from core.tenancy.access import operational_tenant
from core.tenancy.context import tenant_atomic


class PublicFileView(APIView):
    """Redirect to a `ready`, `public`, live file of an operational school; 404 otherwise.

    Every miss (unknown or suspended school, other school's file, private, pending, deleted)
    answers the same 404, so a caller learns nothing about which check failed.
    """

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [PublicFileThrottle]

    @extend_schema(
        responses={
            302: None,
            404: OpenApiResponse(description="No such public file (the same for every miss)."),
        },
        auth=[],
    )
    def get(self, request: Request, tenant_id: UUID, file_id: UUID) -> HttpResponseRedirect:
        # `tenants` has no RLS, so the school is read directly, as the payment callback does.
        tenant, refusal = operational_tenant(tenant_id)
        if tenant is None or refusal is not None:
            raise NotFound()
        with tenant_atomic(tenant.pk):
            file = (
                File.objects.alive()
                .filter(pk=file_id, status=FileStatus.READY, visibility=FileVisibility.PUBLIC)
                .first()
            )
        url = get_display_url(file) if file is not None else None
        if url is None:
            raise NotFound()
        response = HttpResponseRedirect(url)
        patch_cache_control(response, public=True, max_age=PUBLIC_FILE_CACHE_SECONDS)
        return response
