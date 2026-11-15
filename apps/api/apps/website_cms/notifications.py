"""Website notification triggers and platform default templates (module doc §12).

`website.contact-received` is emitted by `contact_submissions.services` (via the
`notify_contact_received` task, after the insert commits). The two domain triggers are
emitted by the custom-domain flow in PR D. `notify()` always adds the mandatory in-app
channel, so `website.domain-failed` declares email by default and carries an in-app template
as the floor.
"""

from __future__ import annotations

from uuid import UUID

from apps.website_cms.models import ContactSubmission
from core.notifications.catalog import registry as catalog
from core.notifications.models import Notification, NotificationCategory, NotificationChannel
from core.notifications.services import Recipient, notify
from core.notifications.templates import registry as templates
from core.rbac.models import UserRole

CONTACT_RECEIVED = "website.contact-received"
DOMAIN_ACTIVE = "website.domain-active"
DOMAIN_FAILED = "website.domain-failed"

CONTACT_SOURCE = "contact_submission"
CONTACT_RECIPIENT_ROLES = ("reception", "school_admin")
DOMAIN_RECIPIENT_ROLES = ("it_admin",)

PREVIEW_LENGTH = 200

_CONTACT_VARS = {"contact.name", "contact.subject", "contact.preview", "school.name"}
_DOMAIN_ACTIVE_VARS = {"domain.hostname", "school.name"}
_DOMAIN_FAILED_VARS = {"domain.hostname", "domain.reason", "school.name"}

catalog.register(
    CONTACT_RECEIVED,
    template_code=CONTACT_RECEIVED,
    category=NotificationCategory.GENERAL,
    channels={NotificationChannel.EMAIL},
    variables=_CONTACT_VARS,
    description="A visitor sent a message through the public website contact form.",
)
for _channel in (NotificationChannel.IN_APP, NotificationChannel.EMAIL):
    templates.register(
        CONTACT_RECEIVED,
        channel=_channel,
        subject="New website message: {{ contact.subject }}",
        body=(
            "{{ contact.name }} sent a message through the {{ school.name }} website: "
            "{{ contact.preview }}"
        ),
        variables=_CONTACT_VARS,
    )

catalog.register(
    DOMAIN_ACTIVE,
    template_code=DOMAIN_ACTIVE,
    category=NotificationCategory.GENERAL,
    channels={NotificationChannel.EMAIL},
    variables=_DOMAIN_ACTIVE_VARS,
    description="A custom domain was verified and its certificate issued.",
)
for _channel in (NotificationChannel.IN_APP, NotificationChannel.EMAIL):
    templates.register(
        DOMAIN_ACTIVE,
        channel=_channel,
        subject="{{ domain.hostname }} is now live",
        body=(
            "The custom domain {{ domain.hostname }} for {{ school.name }} is verified and active."
        ),
        variables=_DOMAIN_ACTIVE_VARS,
    )

catalog.register(
    DOMAIN_FAILED,
    template_code=DOMAIN_FAILED,
    category=NotificationCategory.GENERAL,
    channels={NotificationChannel.EMAIL},
    variables=_DOMAIN_FAILED_VARS,
    description="A custom domain has failed verification for more than 24 hours.",
)
for _channel in (NotificationChannel.IN_APP, NotificationChannel.EMAIL):
    templates.register(
        DOMAIN_FAILED,
        channel=_channel,
        subject="{{ domain.hostname }} could not be verified",
        body=(
            "The custom domain {{ domain.hostname }} for {{ school.name }} has not verified "
            "for over 24 hours: {{ domain.reason }}. Check its DNS records."
        ),
        variables=_DOMAIN_FAILED_VARS,
    )


def role_recipients(tenant_id: UUID, role_slugs: tuple[str, ...]) -> list[Recipient]:
    """The tenant's users holding any of the roles, once each."""
    user_ids = (
        UserRole.objects.filter(
            role__slug__in=role_slugs, role__deleted_at__isnull=True, user__tenant_id=tenant_id
        )
        .values_list("user_id", flat=True)
        .distinct()
    )
    return [Recipient(user_id=user_id) for user_id in user_ids]


def already_notified(submission: ContactSubmission) -> bool:
    """A redelivered task must not notify twice: `notify()` stamps the source on every row."""
    return Notification.objects.filter(
        event_key=CONTACT_RECEIVED, source_type=CONTACT_SOURCE, source_id=submission.id
    ).exists()


def notify_contact_received(submission: ContactSubmission) -> None:
    """Tell reception and the school admins; a school with neither is a silent no-op."""
    recipients = role_recipients(submission.tenant_id, CONTACT_RECIPIENT_ROLES)
    if not recipients:
        return
    preview = submission.message
    if len(preview) > PREVIEW_LENGTH:
        preview = f"{preview[: PREVIEW_LENGTH - 1]}…"
    notify(
        CONTACT_RECEIVED,
        tenant_id=submission.tenant_id,
        recipients=recipients,
        context={
            "contact.name": submission.name,
            "contact.subject": submission.subject or "(no subject)",
            "contact.preview": preview,
            "school.name": submission.tenant.name,
        },
        source_type=CONTACT_SOURCE,
        source_id=submission.id,
    )
