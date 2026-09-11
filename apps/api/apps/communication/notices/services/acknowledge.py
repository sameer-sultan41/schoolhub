"""Idempotent notice acknowledgment."""

from __future__ import annotations

import uuid

from django.utils import timezone

from apps.communication.models import Notice, NoticeStatus
from core.api.exceptions import DomainRuleViolation
from core.notifications.models import Notification


def acknowledge_notice(notice: Notice, *, actor_id: uuid.UUID) -> None:
    """A second acknowledgment from the same user is a no-op, not an error —
    a guardian double-tapping "acknowledge" must not 500.

    Tracked on the recipient's own `Notification.acknowledged_at` row rather
    than a new table — one row per (notice, recipient) already exists there
    from the publish fan-out.
    """
    if notice.status != NoticeStatus.PUBLISHED:
        raise DomainRuleViolation({"status": "Only a published notice can be acknowledged."})
    if not notice.requires_acknowledgment:
        raise DomainRuleViolation(
            {"requires_acknowledgment": "This notice does not require acknowledgment."}
        )

    Notification.objects.filter(
        tenant_id=notice.tenant_id,
        user_id=actor_id,
        source_type="notice",
        source_id=notice.pk,
        acknowledged_at__isnull=True,
    ).update(acknowledged_at=timezone.now())
