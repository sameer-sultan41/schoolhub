"""Draft/scheduled -> published: resolves the audience, fans out once."""

from __future__ import annotations

import uuid

from django.utils import timezone

from apps.communication import audience
from apps.communication.models import Announcement, AnnouncementStatus
from core.api.exceptions import DomainRuleViolation
from core.notifications.services import Recipient, notify


def publish_announcement(announcement: Announcement, *, actor_id: uuid.UUID) -> Announcement:
    """§12 fires on the transition, not on current status, so a retry after a
    partial failure never re-notifies an already-published announcement — the
    `status` check below is what makes this safe to call twice."""
    locked = Announcement.objects.select_for_update().get(pk=announcement.pk)
    if locked.status == AnnouncementStatus.PUBLISHED:
        raise DomainRuleViolation({"status": "This announcement is already published."})

    recipients = audience.resolve_audience(
        audience_type=locked.audience_type,
        audience_filter=locked.audience_filter,
        tenant_id=locked.tenant_id,
        campus_id=locked.campus_id,
    )
    audience.assert_audience_is_nonempty(recipients)

    now = timezone.now()
    locked.status = AnnouncementStatus.PUBLISHED
    locked.published_by = actor_id
    locked.published_at = now
    locked.updated_by = actor_id
    locked.save(
        update_fields=["status", "published_by", "published_at", "updated_by", "updated_at"]
    )

    # One notify() call for the whole resolved audience — never per-recipient.
    # The fees-finance review caught exactly this anti-pattern once already
    # this session; §5 explicitly expects one announcement to reach thousands.
    notify(
        "communication.announcement-published",
        tenant_id=locked.tenant_id,
        recipients=[Recipient(user_id=uid) for uid in recipients],
        context={"announcement.title": locked.title, "announcement.body": locked.body},
        source_type="announcement",
        source_id=locked.pk,
    )
    return locked
