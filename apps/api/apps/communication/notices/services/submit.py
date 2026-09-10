"""draft -> pending_approval."""

from __future__ import annotations

import uuid

from apps.communication.models import Notice, NoticeStatus
from core.api.exceptions import DomainRuleViolation


def submit_notice(notice: Notice, *, actor_id: uuid.UUID) -> Notice:
    locked = Notice.objects.select_for_update().get(pk=notice.pk)
    if locked.status != NoticeStatus.DRAFT:
        raise DomainRuleViolation(
            {"status": f"Only a draft notice can be submitted (this one is {locked.status})."}
        )
    locked.status = NoticeStatus.PENDING_APPROVAL
    locked.updated_by = actor_id
    locked.save(update_fields=["status", "updated_by", "updated_at"])
    return locked
