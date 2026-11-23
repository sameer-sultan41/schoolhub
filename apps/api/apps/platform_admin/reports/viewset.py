"""`GET /platform/reports/{key}?format=json|csv|xlsx` (`platform.report.view`, §13).

Platform scope with no school bound: the reports read `tenants` and the usage snapshots only
(`registry.py`). JSON answers the named sections; CSV and XLSX flatten them into one table
with a leading `section` column, rendered by `core.exports.tabular.render`.
"""

from __future__ import annotations

from django.http import HttpResponse
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, OpenApiResponse, extend_schema
from rest_framework import exceptions
from rest_framework.request import Request
from rest_framework.response import Response

from apps.platform_admin.reports.registry import REPORTS, Sections
from core.api.platform import PlatformViewSet
from core.exports import tabular

#: The formats a platform report renders to; JSON is the console's own.
FILE_FORMATS = ("csv", "xlsx")


def flatten(sections: Sections) -> list[dict]:
    """One table: each row tagged with its section, under the union of every section's columns."""
    columns: dict[str, None] = {"section": None}
    for rows in sections.values():
        for row in rows:
            columns.update(dict.fromkeys(row))
    return [
        {column: ({"section": name} | row).get(column) for column in columns}
        for name, rows in sections.items()
        for row in rows
    ]


class PlatformReportViewSet(PlatformViewSet):
    required_permission = "platform.report.view"
    http_method_names = ["get", "head", "options"]

    @extend_schema(
        summary="A platform report: tenant-overview, revenue or usage",
        parameters=[
            OpenApiParameter(
                "format", OpenApiTypes.STR, enum=["json", *FILE_FORMATS], required=False
            )
        ],
        responses={
            200: OpenApiResponse(
                description="JSON: {key, title, generated_at, sections: {name: [row]}}; "
                "CSV or XLSX: the sections as one table, as an attachment."
            ),
            404: OpenApiResponse(description="An unknown report key."),
        },
    )
    def retrieve(self, request: Request, key: str | None = None) -> Response | HttpResponse:
        report = REPORTS.get(key or "")
        if report is None:
            raise exceptions.NotFound()
        fmt = request.query_params.get("format", "json")
        if fmt != "json" and fmt not in FILE_FORMATS:
            raise exceptions.ValidationError({"format": f"One of json, {', '.join(FILE_FORMATS)}."})

        sections = report.build()
        generated_at = timezone.now()
        if fmt == "json":
            return Response(
                {
                    "key": report.key,
                    "title": report.title,
                    "generated_at": generated_at,
                    "sections": sections,
                }
            )
        data, mime_type, extension = tabular.render(flatten(sections), fmt=fmt, title=report.title)
        response = HttpResponse(data, content_type=mime_type)
        filename = f"{report.key}-{generated_at:%Y%m%d}.{extension}"
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response
