"""The invitation email, on the ``transactional`` queue (``core.rbac.*.tasks.*``).

Arguments are ids only. The token is minted inside the task, so it is never written to
the broker or to the database in raw form.
"""

from __future__ import annotations

import smtplib
import uuid

from celery import shared_task

from core.rbac.auth_emails import MAX_EMAIL_RETRIES, TRANSIENT_EMAIL_ERRORS
from core.rbac.invitations import services
from core.tenancy.tasks import TenantAwareTask


class InvitationEmailTask(TenantAwareTask):
    abstract = True

    def on_failure(self, exc, task_id, args, kwargs, error_info):
        """Retries are spent (or the error was not transient): mark the invitation."""
        services.mark_send_failed(
            tenant_id=uuid.UUID(str(kwargs["tenant_id"])),
            invitation_id=uuid.UUID(str(kwargs["invitation_id"])),
            error=send_error_summary(exc),
        )


def send_error_summary(exc: BaseException) -> str:
    """The exception class and any SMTP status codes, never the message.

    An SMTP error's message can name the recipient (`SMTPRecipientsRefused` holds the
    refused addresses), and the audit row must not store that address.
    """
    codes: set[int] = set()
    if isinstance(exc, smtplib.SMTPResponseException):
        codes.add(exc.smtp_code)
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        codes.update(code for code, _message in exc.recipients.values())
    name = type(exc).__name__
    return f"{name} {','.join(str(code) for code in sorted(codes))}" if codes else name


@shared_task(
    base=InvitationEmailTask,
    bind=True,
    autoretry_for=TRANSIENT_EMAIL_ERRORS,
    max_retries=MAX_EMAIL_RETRIES,
    retry_backoff=True,
)
def send_invitation_email(self, *, tenant_id: str, invitation_id: str) -> bool:
    return services.deliver_invitation(
        tenant_id=uuid.UUID(tenant_id), invitation_id=uuid.UUID(invitation_id)
    )
