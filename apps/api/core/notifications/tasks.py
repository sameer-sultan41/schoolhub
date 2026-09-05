"""Delivery workers.

`notify()` has already persisted every row by the time this runs, so a task here
only ever *attempts* a send and records the outcome. Losing the task loses
attempts, never the record that the notification was owed.

Retries: one Celery-level retry with backoff, deliberately short of §6's full
1m/5m/30m/2h/6h schedule. That schedule pairs with provider status webhooks,
circuit-breaking and dead-lettering, none of which exist until communication
(Tier 4) — a five-stage retry with nothing reading the delivery receipts would be
ceremony, not reliability.

The retry has to be *taken*, not merely configured. `_attempt` previously caught
every adapter exception and returned `False`, so `self.retry()` was never called
and `max_retries`/`RETRY_BACKOFF_SECONDS` were decoration: a transient SMTP
timeout was recorded `failed` on the first try and never tried again. The task
now re-raises transient failures so Celery can retry the batch, and records
`attempts` and `error_message` on the row either way so the gap stays visible.
"""

from __future__ import annotations

import logging
import uuid

from celery import shared_task
from django.utils import timezone

from core.notifications.adapters import ChannelUnavailable, RenderedMessage, get_adapter
from core.notifications.models import DeliveryLog, DeliveryStatus, NotificationChannel
from core.notifications.services import resolve_addresses
from core.tenancy.context import tenant_atomic
from core.tenancy.tasks import TenantAwareTask

logger = logging.getLogger(__name__)

MAX_RETRIES = 1
RETRY_BACKOFF_SECONDS = 60


@shared_task(base=TenantAwareTask, bind=True, max_retries=MAX_RETRIES)
def deliver_notifications(self, *, tenant_id: str, notification_ids: list[str]) -> dict[str, int]:
    """Attempt every queued delivery for these notifications."""
    tenant_uuid = uuid.UUID(tenant_id)
    ids = [uuid.UUID(pk) for pk in notification_ids]

    # Its own tenant_atomic per step rather than one transaction around the whole
    # task — see core/tenancy/tasks.py's docstring for why a long task must not
    # hold one open (progress would stay invisible to anything polling it).
    with tenant_atomic(tenant_uuid):
        deliveries = list(
            DeliveryLog.objects.filter(
                notification_id__in=ids, status=DeliveryStatus.QUEUED
            ).select_related("notification")
        )
        addresses = resolve_addresses([d.notification.user_id for d in deliveries])

    sent = failed = 0
    retryable = False
    for delivery in deliveries:
        outcome = _attempt(tenant_uuid, delivery, addresses)
        if outcome == "sent":
            sent += 1
            continue
        failed += 1
        retryable = retryable or outcome == "retry"

    # Re-raise only after every delivery has had its attempt recorded, so a
    # retry re-runs a strictly smaller set: anything that succeeded is no longer
    # `queued` and the next pass skips it.
    if retryable and self.request.retries < MAX_RETRIES:
        raise self.retry(countdown=RETRY_BACKOFF_SECONDS)

    return {"sent": sent, "failed": failed}


def _attempt(tenant_id: uuid.UUID, delivery: DeliveryLog, addresses: dict[uuid.UUID, str]) -> str:
    """Returns "sent", "retry" or "failed".

    "retry" is reserved for a provider error, which is the only kind that might
    succeed on a second attempt — a missing adapter never will.
    """
    notification = delivery.notification
    address = addresses.get(notification.user_id) or str(notification.user_id)

    try:
        adapter = get_adapter(delivery.channel)
        receipt = adapter.send(
            RenderedMessage(
                channel=delivery.channel,
                recipient_address=address,
                # The stored title/body are already rendered; re-rendering here
                # would need the original context, which is deliberately not
                # persisted (it carries the PII the template pulled from).
                subject=notification.title,
                body=notification.body,
                template_code=delivery.template_code or "",
            )
        )
    except ChannelUnavailable as exc:
        # Not retryable: a channel with no adapter will not grow one between now
        # and sixty seconds from now.
        _record(tenant_id, delivery, status=DeliveryStatus.SKIPPED, error=str(exc))
        return "failed"
    except Exception as exc:  # noqa: BLE001 — any provider error must land on the row
        logger.warning(
            "notification delivery failed: channel=%s notification=%s",
            delivery.channel,
            notification.pk,
        )
        _record(tenant_id, delivery, status=DeliveryStatus.FAILED, error=str(exc))
        return "retry"

    # In-app goes straight to `delivered`: there is no provider hop between "we
    # sent it" and "it arrived" (§8), so leaving it at `sent` would imply a
    # receipt is still owed and make the delivery dashboard permanently wrong.
    delivered = delivery.channel == NotificationChannel.IN_APP
    _record(
        tenant_id,
        delivery,
        status=DeliveryStatus.DELIVERED if delivered else DeliveryStatus.SENT,
        provider=receipt.provider,
        provider_message_id=receipt.provider_message_id,
    )
    return "sent"


def _record(
    tenant_id: uuid.UUID,
    delivery: DeliveryLog,
    *,
    status: str,
    error: str | None = None,
    provider: str | None = None,
    provider_message_id: str | None = None,
) -> None:
    now = timezone.now()
    with tenant_atomic(tenant_id):
        DeliveryLog.objects.filter(pk=delivery.pk).update(
            status=status,
            attempts=delivery.attempts + 1,
            last_attempt_at=now,
            error_message=error,
            provider=provider,
            provider_message_id=provider_message_id,
            delivered_at=now if status == DeliveryStatus.DELIVERED else None,
            updated_at=now,
        )
