"""`dispatch_emergency_broadcast` — confirm the audience, then queue the fan-out.

The send repeats back what the preview showed (`confirm_recipient_count` and
`audience_digest`). The audience is resolved again here and compared, so a send
from a stale tab, or after one recipient left and another joined, is a 409 that
carries the current count and digest rather than a broadcast to people the
sender never saw.

The recipient ids are frozen on the job: the task sends to exactly the audience
that was confirmed, not to whatever it resolves to when a worker picks it up.
"""

from __future__ import annotations

import uuid

from rest_framework.request import Request

from apps.communication.broadcasts.services.preview import (
    audience_digest,
    broadcast_channels,
    resolve_recipients,
)
from apps.communication.tasks import send_emergency_broadcast_task
from core.api.exceptions import Conflict
from core.audit.services import record_audit
from core.jobs.models import BackgroundJob
from core.jobs.services import create_job, enqueue_job

BROADCAST_JOB_TYPE = "communication.emergency-broadcast"
AUDIT_BROADCAST = "broadcast"


class AudienceChanged(Conflict):
    """409: the audience is no longer the one the sender confirmed.

    `meta` carries the current count and digest, so a client can show the new
    numbers and ask again without a second preview call. The envelope handler
    passes `meta` through untouched, as it does for `DomainRuleViolation`.
    """

    default_detail = (
        "The audience changed since the preview. Check the new recipient count and confirm again."
    )
    default_code = "audience_changed"

    def __init__(self, *, recipient_count: int, audience_digest: str) -> None:
        super().__init__()
        self.meta: dict[str, int | str] = {
            "recipient_count": recipient_count,
            "audience_digest": audience_digest,
        }


def dispatch_emergency_broadcast(*, request: Request, data: dict) -> BackgroundJob:
    """Resolve, compare, then create, audit and enqueue the job.

    ``data`` is `BroadcastSendSerializer.validated_data`. Raises
    `AudienceChanged` before anything is written.
    """
    tenant_id: uuid.UUID = request.tenant.pk
    campus_id: uuid.UUID | None = data["campus_id"]
    audience_filter: dict = data["audience_filter"]

    recipients = resolve_recipients(
        tenant_id=tenant_id,
        audience_type=data["audience_type"],
        audience_filter=audience_filter,
        campus_id=campus_id,
    )
    digest = audience_digest(recipients)
    if len(recipients) != data["confirm_recipient_count"] or digest != data["audience_digest"]:
        raise AudienceChanged(recipient_count=len(recipients), audience_digest=digest)

    channels, unavailable_channels = broadcast_channels()
    audience = {
        "audience_type": data["audience_type"],
        "audience_filter": audience_filter,
        "campus_id": str(campus_id) if campus_id else None,
    }
    job = create_job(
        tenant_id=tenant_id,
        job_type=BROADCAST_JOB_TYPE,
        payload={
            "recipient_ids": [str(pk) for pk in recipients],
            "message": data["message"],
            **audience,
        },
        actor_id=request.user.pk,
        # Second line of defence behind `replay_or_execute`: two requests racing
        # with the same key cannot both create a job (the unique index refuses
        # the second), so a double click never fans out twice.
        idempotency_key=request.headers.get("Idempotency-Key"),
    )
    record_audit(
        request,
        AUDIT_BROADCAST,
        job,
        after={
            "recipient_count": len(recipients),
            "channels": channels,
            "unavailable_channels": unavailable_channels,
            "message": data["message"],
            **audience,
        },
    )
    enqueue_job(job=job, task=send_emergency_broadcast_task)
    return job
