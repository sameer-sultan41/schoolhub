"""Celery tasks for the communication module (module doc §16).

Thin, as `staff_management/tasks.py`'s are: claim the job, do the one call, and
record the outcome on the job.
"""

from __future__ import annotations

import logging
import uuid

from celery import shared_task

from apps.communication.notifications import EMERGENCY_BROADCAST
from core.jobs.services import claim_queued_job, mark_failed, mark_succeeded
from core.notifications.services import Recipient, notify
from core.tenancy.context import tenant_atomic
from core.tenancy.tasks import TenantAwareTask

logger = logging.getLogger(__name__)

EMERGENCY_BROADCAST_SOURCE_TYPE = "emergency_broadcast"


@shared_task(base=TenantAwareTask, bind=True)
def send_emergency_broadcast_task(self, *, tenant_id: str, job_id: str, actor_id: str) -> None:
    """Fan the broadcast out to the recipients frozen on the job, on the `emergency` lane.

    Preferences are not consulted: `notify()` never gates an `emergency`-category
    trigger. One transaction for the whole fan-out, so a failure leaves no
    half-sent broadcast behind it.

    The job is claimed with `claim_queued_job`, a conditional UPDATE from `queued`
    to `running`, before anything is sent. A redelivered or re-enqueued task, even
    one running at the same moment as the first, finds the row already claimed and
    returns: an emergency fan-out must reach each recipient once.
    """
    job = claim_queued_job(tenant_id=uuid.UUID(tenant_id), job_id=job_id)
    if job is None:
        logger.warning(
            "Emergency broadcast job %s is not queued (already claimed or finished); skipped.",
            job_id,
        )
        return
    try:
        recipient_ids: list[str] = job.payload["recipient_ids"]
        with tenant_atomic(uuid.UUID(tenant_id)):
            notifications = notify(
                EMERGENCY_BROADCAST,
                tenant_id=uuid.UUID(tenant_id),
                recipients=[Recipient(user_id=uuid.UUID(pk)) for pk in recipient_ids],
                context={"broadcast.message": job.payload["message"]},
                source_type=EMERGENCY_BROADCAST_SOURCE_TYPE,
                source_id=job.pk,
            )
        mark_succeeded(
            job=job,
            result={
                "recipient_count": len(recipient_ids),
                "notification_count": len(notifications),
            },
        )
    except Exception as exc:
        # Not re-raised, as in apps/staff_management/tasks.py:72,90: the job row is
        # how a caller learns the outcome, and the fan-out above already rolled
        # back. Logged with the traceback, since nobody is watching an emergency
        # send fail otherwise.
        logger.exception("Emergency broadcast job %s failed", job.pk)
        mark_failed(job=job, error=str(exc))
