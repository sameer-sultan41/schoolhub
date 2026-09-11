"""pending_approval -> draft, with comments."""

from __future__ import annotations

import uuid

from apps.communication.models import Notice, NoticeStatus
from apps.communication.notices.services.locking import locked_notice
from core.api.exceptions import DomainRuleViolation


def return_notice_to_draft(notice: Notice, *, actor_id: uuid.UUID) -> Notice:
    """§7's workflow diagram: a returned notice goes back to draft, not to a
    third "rejected" state — the drafter edits and resubmits through the same
    `:submit` step."""
    locked = locked_notice(notice)
    if locked.status != NoticeStatus.PENDING_APPROVAL:
        raise DomainRuleViolation(
            {"status": "Only a notice pending approval can be returned to draft."}
        )
    locked.status = NoticeStatus.DRAFT
    locked.updated_by = actor_id
    locked.save(update_fields=["status", "updated_by", "updated_at"])
    return locked
