"""pending_approval -> published: allocates notice_no, resolves the audience,
fans out once."""

from __future__ import annotations

import uuid

from django.utils import timezone

from apps.communication import audience
from apps.communication.models import Notice, NoticeStatus
from apps.communication.notices import numbering
from core.api.exceptions import DomainRuleViolation
from core.notifications.services import Recipient, notify


def publish_notice(notice: Notice, *, actor_id: uuid.UUID) -> Notice:
    """The approver must differ from the drafter — auth-and-rbac.md §2.4,
    checked here so the rule holds regardless of which door a caller
    approves through, the same shape `fees_finance.decide_refund` uses."""
    locked = Notice.objects.select_for_update().get(pk=notice.pk)
    if locked.status != NoticeStatus.PENDING_APPROVAL:
        raise DomainRuleViolation(
            {"status": "A notice must be pending approval before it can be published."}
        )
    if locked.created_by == actor_id:
        raise DomainRuleViolation(
            {
                "approved_by": (
                    "The person who drafted a notice cannot approve it (auth-and-rbac §2.4)."
                )
            }
        )

    recipients = audience.resolve_audience(
        audience_type=locked.audience_type,
        audience_filter=locked.audience_filter,
        tenant_id=locked.tenant_id,
    )
    audience.assert_audience_is_nonempty(recipients)

    now = timezone.now()
    locked.notice_no = numbering.allocate_notice_no(tenant_id=locked.tenant_id, on_date=now.date())
    locked.status = NoticeStatus.PUBLISHED
    locked.approved_by = actor_id
    locked.published_at = now
    locked.updated_by = actor_id
    locked.save(
        update_fields=[
            "notice_no",
            "status",
            "approved_by",
            "published_at",
            "updated_by",
            "updated_at",
        ]
    )

    notify(
        "communication.notice-published",
        tenant_id=locked.tenant_id,
        recipients=[Recipient(user_id=uid) for uid in recipients],
        context={
            "notice.notice_no": locked.notice_no,
            "notice.title": locked.title,
            "notice.body": locked.body,
        },
        source_type="notice",
        source_id=locked.pk,
    )
    return locked
