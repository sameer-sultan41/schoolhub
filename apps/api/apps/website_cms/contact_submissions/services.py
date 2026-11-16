"""Contact submissions: the public insert and staff triage (module doc §5.9).

`create_contact_submission` takes the client IP as a parameter so it never depends on a
request; PR C's public POST derives it and calls this inside `tenant_atomic`.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from django.core.exceptions import ValidationError
from django.core.validators import EmailValidator
from django.db import transaction

from apps.website_cms.constants import (
    CONTACT_EMAIL_MAX,
    CONTACT_MESSAGE_MAX,
    CONTACT_NAME_MAX,
    CONTACT_PHONE_RE,
    CONTACT_SUBJECT_MAX,
)
from apps.website_cms.content import locked, touch
from apps.website_cms.errors import violation
from apps.website_cms.models import ContactStatus, ContactSubmission, ContentStatus, WebsitePage
from apps.website_cms.tasks import notify_contact_received
from core.rbac.models import User
from core.tenancy.models import Tenant

_email_validator = EmailValidator()
# Single-line fields: a newline in them would reach an email header or a one-line title.
_SINGLE_LINE_FIELDS = ("name", "subject", "phone")


def _clean(data: dict[str, Any], source_page: WebsitePage | None) -> dict[str, str]:
    """The trimmed fields, or the first rule broken as a field-keyed 422."""
    values = {
        key: str(data.get(key) or "").strip()
        for key in ("name", "email", "phone", "subject", "message")
    }
    for key in _SINGLE_LINE_FIELDS:
        values[key] = " ".join(values[key].split())
    if not values["name"] or len(values["name"]) > CONTACT_NAME_MAX:
        raise violation(
            "name", "invalid_name", f"enter a name of 1 to {CONTACT_NAME_MAX} characters."
        )
    if not values["email"] and not values["phone"]:
        raise violation("email", "contact_required", "give an email address or a phone number.")
    if values["email"]:
        try:
            _email_validator(values["email"])
        except ValidationError:
            raise violation("email", "invalid_email", "enter a valid email address.") from None
        if len(values["email"]) > CONTACT_EMAIL_MAX:
            raise violation("email", "invalid_email", "enter a valid email address.")
    phone = values["phone"]
    if phone and not (CONTACT_PHONE_RE.match(phone) and any(ch.isdigit() for ch in phone)):
        raise violation("phone", "invalid_phone", "enter a valid phone number.")
    if len(values["subject"]) > CONTACT_SUBJECT_MAX:
        raise violation(
            "subject", "subject_too_long", f"use at most {CONTACT_SUBJECT_MAX} characters."
        )
    if not values["message"] or len(values["message"]) > CONTACT_MESSAGE_MAX:
        raise violation(
            "message",
            "invalid_message",
            f"write a message of 1 to {CONTACT_MESSAGE_MAX} characters.",
        )
    if source_page is not None:
        live = WebsitePage.objects.alive().filter(pk=source_page.pk, status=ContentStatus.PUBLISHED)
        if not live.exists():
            raise violation("source_page", "invalid_source_page", "the page is not published.")
    return values


def create_contact_submission(
    tenant: Tenant, data: dict[str, Any], ip: str | None, source_page: WebsitePage | None
) -> ContactSubmission:
    """Validate, store the message (status `new`, no author) and notify staff on commit.

    The service owns the rules (422 per field), so no caller can bypass them.
    """
    values = _clean(data, source_page)
    submission = ContactSubmission.objects.create(
        tenant=tenant,
        **values,
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
