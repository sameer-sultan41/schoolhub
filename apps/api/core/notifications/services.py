"""The entry point every module calls: `notify(event_key, ...)`.

Shape follows notifications.md §3.4 exactly — **persist first, enqueue second**.
One `Notification` row per recipient and one `DeliveryLog` per recipient per
channel are written inside the caller's transaction; only then is delivery
dispatched. A worker that dies has lost delivery attempts, never the record that
the notification was owed, and a support case ("the parent says they never got the
absence alert") is answerable from the database alone.

What is deliberately **not** here, all communication-module scope (Tier 4):
per-user preferences, quiet-hours deferral, suppression lists, SMS quotas, and
provider status webhooks. Until those exist every trigger delivers at §4's
mandatory floor — in-app always, plus email where the recipient has an address —
which is the safe direction to be wrong in.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass

from django.db import transaction

from core.notifications.adapters import available_channels
from core.notifications.catalog import Trigger
from core.notifications.catalog import registry as catalog
from core.notifications.models import (
    DeliveryLog,
    DeliveryStatus,
    Notification,
    NotificationChannel,
)
from core.notifications.templates import TemplateError
from core.notifications.templates import registry as templates

logger = logging.getLogger(__name__)


class UnknownTrigger(Exception):
    """An event key no module declared in its `notifications.py`."""


@dataclass(frozen=True)
class Recipient:
    """A resolved recipient, identified by their user row.

    `user_id` is the only field because `notifications.user_id` is NOT NULL: in-app
    is the mandatory channel and an inbox row with no owner has nowhere to appear.
    Every other address (email now, phone later) is resolved from the user record
    at send time rather than carried here — see `resolve_addresses`.
    """

    user_id: uuid.UUID


def resolve_addresses(user_ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    """Email address per user id, in one query.

    Resolved at both persist and send time rather than passed in by the caller:
    one bulk query beats an N+1 over a class of forty, and re-resolving at send
    time means a guardian who corrected their email between the trigger firing and
    the worker running gets the message at the new address.
    """
    from core.rbac.models import User

    rows = User.objects.filter(pk__in=user_ids).values_list("pk", "email")
    return {pk: email for pk, email in rows if email}


def mask_address(address: str) -> str:
    """Mask a delivery address for storage.

    `delivery_logs.recipient_address` is spec'd as "stored masked per PII policy",
    and this is one of the highest-volume tables in the platform — an unmasked copy
    of every guardian's email, retained for operational history, is exactly the
    secondary PII store security.md exists to prevent. Enough survives to correlate
    a support case; not enough to re-contact anyone.
    """
    if not address:
        return ""
    if "@" in address:
        local, _, domain = address.partition("@")
        return f"{local[:2]}{'*' * max(len(local) - 2, 1)}@{domain}"
    return f"{'*' * max(len(address) - 4, 1)}{address[-4:]}"


@transaction.atomic
def notify(
    event_key: str,
    *,
    tenant_id: uuid.UUID,
    recipients: list[Recipient],
    context: dict[str, object],
    source_type: str | None = None,
    source_id: uuid.UUID | None = None,
) -> list[Notification]:
    """Persist a notification per recipient, then queue its deliveries.

    Returns the persisted rows. Callers never wait for delivery — anything with an
    outbound effect is asynchronous (api-architecture.md §2.7).
    """
    trigger = catalog.get(event_key)
    if trigger is None:
        raise UnknownTrigger(
            f"No notification trigger declared for {event_key!r}. Declare it in the "
            "emitting module's notifications.py — see core/notifications/catalog.py."
        )

    missing = trigger.variables - set(context)
    if missing:
        raise TemplateError(
            f"Trigger {event_key!r} requires context variables: {', '.join(sorted(missing))}"
        )

    in_app = templates.get(trigger.template_code, NotificationChannel.IN_APP)
    if in_app is None:
        # The mandatory channel has no template, so there is nothing to put in the
        # inbox: the trigger is declared wrongly. Only reachable by a coding error, and
        # loud rather than a silently emptier fan-out.
        raise TemplateError(
            f"Trigger {trigger.event_key!r} has no in-app template "
            f"({trigger.template_code!r}) — the mandatory channel cannot be skipped."
        )

    title, body = in_app.render(context)
    emails = resolve_addresses([r.user_id for r in recipients])

    created = [
        _persist(
            trigger=trigger,
            tenant_id=tenant_id,
            recipient=recipient,
            title=title,
            body=body,
            email=emails.get(recipient.user_id),
            source_type=source_type,
            source_id=source_id,
        )
        for recipient in recipients
    ]

    if created:
        # on_commit, never inside the transaction: a worker that starts while these
        # rows are still uncommitted would find nothing and fail every delivery.
        ids = [n.pk for n in created]
        transaction.on_commit(lambda: _dispatch(tenant_id, ids))

    return created


def _persist(
    *,
    trigger: Trigger,
    tenant_id: uuid.UUID,
    recipient: Recipient,
    title: str,
    body: str,
    email: str | None,
    source_type: str | None,
    source_id: uuid.UUID | None,
) -> Notification:
    notification = Notification.objects.create(
        tenant_id=tenant_id,
        user_id=recipient.user_id,
        event_key=trigger.event_key,
        category=trigger.category,
        priority=trigger.priority,
        title=title,
        body=body,
        data={"source_type": source_type, "source_id": str(source_id)} if source_id else None,
        source_type=source_type,
        source_id=source_id,
    )

    DeliveryLog.objects.bulk_create(
        [
            _delivery_for(
                notification=notification,
                tenant_id=tenant_id,
                channel=channel,
                trigger=trigger,
                recipient=recipient,
                email=email,
            )
            for channel in sorted(trigger.channels)
        ]
    )
    return notification


def _delivery_for(
    *,
    notification: Notification,
    tenant_id: uuid.UUID,
    channel: str,
    trigger: Trigger,
    recipient: Recipient,
    email: str | None,
) -> DeliveryLog:
    address = str(recipient.user_id) if channel == NotificationChannel.IN_APP else None
    if channel == NotificationChannel.EMAIL:
        address = email

    # `skipped` with a reason rather than no row at all, per §6: a send that did
    # not happen is recorded, never silently dropped — that is what makes a
    # delivery dashboard worth looking at.
    if channel not in available_channels():
        reason: str | None = f"No adapter for {channel} yet."
    elif templates.get(trigger.template_code, channel) is None:
        reason = f"No {channel} template for {trigger.template_code}."
    elif not address:
        reason = f"Recipient has no {channel} address."
    else:
        reason = None

    return DeliveryLog(
        tenant_id=tenant_id,
        notification=notification,
        channel=channel,
        template_code=trigger.template_code,
        recipient_address=mask_address(address or ""),
        status=DeliveryStatus.QUEUED if reason is None else DeliveryStatus.SKIPPED,
        error_message=reason,
    )


def _dispatch(tenant_id: uuid.UUID, notification_ids: list[uuid.UUID]) -> None:
    from core.notifications.tasks import deliver_notifications

    deliver_notifications.delay(
        tenant_id=str(tenant_id), notification_ids=[str(pk) for pk in notification_ids]
    )
