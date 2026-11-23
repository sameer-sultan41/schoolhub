"""The `:export` job's task. Named into `apps.platform_admin.tasks.*` (ruling C5), which
`CELERY_TASK_ROUTES` sends to `bulk`; the app's root `tasks.py` imports it for the worker."""

from __future__ import annotations

import logging
import uuid

from celery import shared_task

from apps.platform_admin.export import services
from core.jobs.services import claim_queued_job, mark_failed, mark_succeeded
from core.tenancy.tasks import TenantAwareTask

logger = logging.getLogger(__name__)


@shared_task(base=TenantAwareTask, bind=True, name="apps.platform_admin.tasks.export_tenant")
def export_tenant(self, *, tenant_id: str, job_id: str, actor_id: str) -> None:
    """Write the school's export archive and record it on the job.

    The job is claimed with a compare-and-set, so a redelivered task never runs a second
    export. A failure is the job's: it is marked failed with the error, not re-raised, since
    each step above committed on its own and the client reads the job, not Celery.
    """
    job = claim_queued_job(tenant_id=uuid.UUID(tenant_id), job_id=job_id)
    if job is None:
        return
    try:
        result = services.run_export(tenant_id=uuid.UUID(tenant_id), actor_id=uuid.UUID(actor_id))
    except Exception as exc:
        logger.exception("Tenant export %s failed for tenant %s", job_id, tenant_id)
        mark_failed(job=job, error=str(exc) or exc.__class__.__name__)
        return
    mark_succeeded(job=job, result=result)
