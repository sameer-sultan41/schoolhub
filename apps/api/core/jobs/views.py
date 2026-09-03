from __future__ import annotations

from rest_framework import mixins, viewsets

from core.api.viewsets import TenantScopedViewSetMixin
from core.jobs.models import BackgroundJob
from core.jobs.serializers import BackgroundJobSerializer


class JobViewSet(TenantScopedViewSetMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """`GET /api/v1/jobs/{id}` (api-architecture.md §2.7).

    No list — jobs are discovered from the `job_id` a `202` response returns,
    never browsed. Restricted to jobs the caller themselves created,
    regardless of their record scope elsewhere: "permission context is the
    initiator's" (entities/tenancy.md), not a role-wide grant.
    """

    queryset = BackgroundJob.objects
    serializer_class = BackgroundJobSerializer
    required_permission = "platform.job.view"

    def get_queryset(self):
        return super().get_queryset().filter(created_by=self.request.user.pk)
