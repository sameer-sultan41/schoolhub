"""`POST /platform/tenants/{tenant_pk}:export` and `GET .../tenants/{tenant_pk}/jobs/{job_id}`.

Nested under the school and bound to it (`PlatformTenantNestedMixin`): the job, its replay
record, the audit row and the archive all belong to that school. Polling sees that school's
platform jobs only (`tenant_export`), never the jobs its own staff started.
"""

from __future__ import annotations

from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import exceptions
from rest_framework.request import Request
from rest_framework.response import Response

from apps.platform_admin.constants import TENANT_EXPORT_JOB_TYPE
from apps.platform_admin.export import services
from apps.platform_admin.export.serializers import PlatformJobSerializer
from apps.platform_admin.export.tasks import export_tenant
from core.api.platform import PlatformTenantNestedMixin, PlatformViewSet
from core.api.viewsets import ActionResponse
from core.audit.services import record_audit
from core.jobs.models import BackgroundJob
from core.jobs.services import enqueue_job

_EXPORT = "platform.tenant.export"

#: The job types the console may poll: the platform's own actions on a school.
PLATFORM_JOB_TYPES = (TENANT_EXPORT_JOB_TYPE,)


class TenantExportViewSet(PlatformTenantNestedMixin, PlatformViewSet):
    serializer_class = PlatformJobSerializer
    # The poll hands out a link to the whole school's archive, so it needs the export key.
    required_permission = _EXPORT
    required_permission_map = {"export": _EXPORT, "retrieve": _EXPORT}
    http_method_names = ["get", "post", "head", "options"]

    @extend_schema(
        summary="Export the school's data and files (a job; poll .../jobs/{job_id})",
        request=None,
        responses={
            202: OpenApiResponse(
                description="{'data': {'job_id': str, 'status': 'queued'}}. An export already "
                "queued or running is returned instead of starting another."
            )
        },
    )
    def export(self, request: Request, tenant_pk=None) -> Response:
        def execute() -> Response:
            job, created = services.start_export(request.tenant, actor_id=request.user.pk)
            if not created:
                return ActionResponse.accepted(str(job.pk), message="An export is in progress.")
            enqueue_job(job=job, task=export_tenant)
            record_audit(request, "export", request.tenant, after={"job_id": str(job.pk)})
            return ActionResponse.accepted(str(job.pk), message="Export queued.")

        return self.run_idempotent("platform-tenants:export", execute)

    @extend_schema(summary="Poll one of the school's platform jobs")
    def retrieve(self, request: Request, tenant_pk=None, job_id=None) -> Response:
        job = BackgroundJob.objects.filter(pk=job_id, job_type__in=PLATFORM_JOB_TYPES).first()
        if job is None:
            raise exceptions.NotFound()
        return Response(PlatformJobSerializer(job).data)
