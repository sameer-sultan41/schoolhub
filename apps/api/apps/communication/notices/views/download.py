"""`notices/views/download.py` — the `/download` action mixin."""

from __future__ import annotations

from django.http import HttpResponse
from drf_spectacular.utils import extend_schema
from rest_framework.request import Request
from rest_framework.response import Response

from apps.communication.action_mixin import ActionMixinBase
from apps.communication.notices import documents


class DownloadActionMixin(ActionMixinBase):
    @extend_schema(responses={200: None})
    def download(self, request: Request, pk: str | None = None) -> Response:
        """`GET /notices/{id}/download` — the notice rendered as a PDF document."""
        instance = self.get_object()
        data = documents.render_notice(notice=instance, school_name=request.tenant.name)
        response = HttpResponse(data, content_type="application/pdf")
        response["Content-Disposition"] = (
            f'inline; filename="notice-{instance.notice_no or instance.pk}.pdf"'
        )
        return response
