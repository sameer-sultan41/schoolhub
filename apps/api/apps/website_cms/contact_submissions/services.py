"""Contact submissions: the public insert and staff triage (module doc §5.9).

`create_contact_submission` takes the client IP as a parameter so it never depends on a
request; PR C's public POST derives it and calls this inside `tenant_atomic`.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from django.db import transaction

from apps.website_cms.content import locked, touch
from apps.website_cms.models import ContactStatus, ContactSubmission, WebsitePage
from apps.website_cms.tasks import notify_contact_received
from core.rbac.models import User
from core.tenancy.models import Tenant


def create_contact_submission(
    tenant: Tenant, data: dict[str, Any], ip: str | None, source_page: WebsitePage | None
) -> ContactSubmission:
    """Store the message (status `new`, no author) and notify staff once the insert commits."""
    submission = ContactSubmission.objects.create(
        tenant=tenant,
        name=data["name"],
        email=data.get("email", ""),
        phone=data.get("phone", ""),
        subject=data.get("subject", ""),
        message=data["message"],
        source_page=source_page,
        ip=ip or None,
    )
    tenant_id, submission_id = str(tenant.id), str(submission.id)
    transaction.on_commit(
        lambda: notify_contact_received.delay(tenant_id=tenant_id, submission_id=submission_id)
    )
    return submission


def set_status(pk: UUID, status: ContactStatus | str, handler: User) -> ContactSubmission:
    """Move a submission to `status` and record who triaged it; the row is locked first."""
    submission = locked(ContactSubmission, pk)
    touch(submission, handler.pk, status=status, handled_by=handler)
    return submission
