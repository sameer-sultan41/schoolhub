"""`POST /platform/tenants/{tenant_pk}:export`, `GET .../tenants/{tenant_pk}/jobs/{job_id}` and
`POST .../jobs/{job_id}:download`.

Nested under the school and bound to it (`PlatformTenantNestedMixin`): the job, its replay
record, the audit rows and the archive all belong to that school. The console sees that
school's platform jobs only (`tenant_export`), never the jobs its own staff started.

The poll carries no link. Each link to the archive is minted by `:download`, which audits who
took which job (SEC-17.5), because the archive holds the whole school's personal data.
"""

from __future__ import annotations

from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import exceptions
from rest_framework.request import Request
from rest_framework.response import Response

from apps.platform_admin.constants import TENANT_EXPORT_JOB_TYPE
from apps.platform_admin.export import services
from apps.platform_admin.export.serializers import (
    ExportAcceptedSerializer,
    ExportDownloadSerializer,
)
from apps.platform_admin.export.tasks import export_tenant
from core.api.exceptions import Conflict
from core.api.platform import PlatformTenantNestedMixin, PlatformViewSet
from core.api.viewsets import ActionResponse
from core.audit.services import record_audit
from core.files.models import File
from core.files.services import get_download_url, servable_file
from core.files.storage import DOWNLOAD_EXPIRY_SECONDS
from core.jobs.models import BackgroundJob, JobStatus
from core.jobs.serializers import BackgroundJobSerializer
from core.jobs.services import enqueue_job

_EXPORT = "platform.tenant.export"

#: The job types the console may poll: the platform's own actions on a school.
PLATFORM_JOB_TYPES = (TENANT_EXPORT_JOB_TYPE,)


class TenantExportViewSet(PlatformTenantNestedMixin, PlatformViewSet):
    serializer_class = BackgroundJobSerializer
    required_permission = _EXPORT
    required_permission_map = {"export": _EXPORT, "retrieve": _EXPORT, "download": _EXPORT}
    http_method_names = ["get", "post", "head", "options"]

    @extend_schema(
        summary="Export the school's data and files (a job; poll .../jobs/{job_id})",
        request=None,
        responses={
            202: OpenApiResponse(
                response=ExportAcceptedSerializer,
                description="An export already queued or running is answered instead of a "
                "new one; one in flight past PLATFORM_EXPORT_TIME_LIMIT_SECONDS is failed and "
                "replaced.",
            )
        },
    )
    def export(self, request: Request, tenant_pk=None) -> Response:
        def execute() -> Response:
            job, created = services.start_export(request.tenant, actor_id=request.user.pk)
            if not created:
                return ActionResponse.accepted(
                    str(job.pk), message="An export is in progress.", data={"status": job.status}
                )
            enqueue_job(job=job, task=export_tenant)
            record_audit(request, "export", request.tenant, after={"job_id": str(job.pk)})
            return ActionResponse.accepted(str(job.pk), message="Export queued.")

        return self.run_idempotent("platform-tenants:export", execute)

    @extend_schema(summary="Poll one of the school's platform jobs")
    def retrieve(self, request: Request, tenant_pk=None, job_id=None) -> Response:
        return Response(BackgroundJobSerializer(self._job(request, job_id)).data)

    @extend_schema(
        summary="A signed link to a finished export's archive (audited)",
        request=None,
        responses={
            200: ExportDownloadSerializer,
            409: OpenApiResponse(description="conflict: the job has not succeeded."),
        },
    )
    def download(self, request: Request, tenant_pk=None, job_id=None) -> Response:
        job = self._job(request, job_id)
        file_id = (job.result or {}).get("result_file_id")
        file = None
        if job.status == JobStatus.SUCCEEDED and file_id:
            stored = File.objects.filter(tenant_id=request.tenant.pk, pk=file_id).first()
            file = servable_file(stored)
        if file is None:
            raise Conflict("The export has not succeeded, so there is nothing to download.")
        record_audit(
            request,
            "export_download",
            request.tenant,
            after={"job_id": str(job.pk), "file_id": str(file.pk)},
        )
        data = {"download_url": get_download_url(file), "expires_in": DOWNLOAD_EXPIRY_SECONDS}
        return Response(ExportDownloadSerializer(data).data)

    @staticmethod
    def _job(request: Request, job_id) -> BackgroundJob:
        # The school is bound, so RLS already scopes this; the explicit filter keeps the 404
        # if a binding ever regresses.
        job = BackgroundJob.objects.filter(
            tenant_id=request.tenant.pk, pk=job_id, job_type__in=PLATFORM_JOB_TYPES
        ).first()
        if job is None:
            raise exceptions.NotFound()
        return job
