"""Security emails: invitation, password reset and "your password was changed".

These are the one exception to "every message goes through ``notify()``"
(notifications.md §3, ADR-0033):

- ``notify()`` persists the rendered body in ``Notification`` and ``DeliveryLog``, which
  delivery-log viewers can read. A body holding a sign-in link would hand those viewers
  the account.
- The templates are platform-only. They are never registered in
  ``core.notifications.templates.registry`` and never looked up through ``resolve()``, so
  a school cannot override the text of a security email, e.g. to send the link elsewhere.

Rendering reuses ``NotificationTemplate.render``: a literal ``{{ name }}`` substitution
over a declared variable set, so a missing variable fails loudly. The email adapter
escapes the HTML part.
"""

from __future__ import annotations

import smtplib

from core.notifications.adapters import RenderedMessage, get_adapter
from core.notifications.models import NotificationChannel
from core.notifications.templates import NotificationTemplate

# Worth another try in the send tasks: the mail server or the network was briefly
# unavailable. Anything else (a template error, a bug) fails at once.
TRANSIENT_EMAIL_ERRORS: tuple[type[BaseException], ...] = (
    smtplib.SMTPException,
    ConnectionError,
    TimeoutError,
)
MAX_EMAIL_RETRIES = 3

INVITATION = NotificationTemplate(
    code="auth.invitation",
    channel=NotificationChannel.EMAIL,
    subject="You're invited to {{ school_name }} on SchoolHub",
    body=(
        "Hello {{ name }},\n\n"
        "{{ school_name }} has invited you to SchoolHub. Open this link to set your "
        "password and activate your account. It works once and expires in "
        "{{ expires_in_hours }} hours.\n\n"
        "{{ link }}\n\n"
        "If you weren't expecting this, you can ignore this email."
    ),
    variables=frozenset({"name", "school_name", "link", "expires_in_hours"}),
)

PASSWORD_RESET = NotificationTemplate(
    code="auth.password_reset",
    channel=NotificationChannel.EMAIL,
    subject="Reset your {{ school_name }} password",
    body=(
        "Hello {{ name }},\n\n"
        "Someone asked to reset the password for your {{ school_name }} account on "
        "SchoolHub. Open this link to choose a new one. It works once and expires in "
        "{{ expires_in_minutes }} minutes.\n\n"
        "{{ link }}\n\n"
        "If you didn't ask for this, you can ignore this email; your password stays "
        "the same."
    ),
    variables=frozenset({"name", "school_name", "link", "expires_in_minutes"}),
)

PASSWORD_CHANGED = NotificationTemplate(
    code="auth.password_changed",
    channel=NotificationChannel.EMAIL,
    subject="Your {{ school_name }} password was changed",
    body=(
        "Hello {{ name }},\n\n"
        "The password for your {{ school_name }} account on SchoolHub was just reset, "
        "and every device signed in to it has been signed out.\n\n"
        "If this wasn't you, contact your school straight away."
    ),
    variables=frozenset({"name", "school_name"}),
)


def send_auth_email(template: NotificationTemplate, *, to: str, context: dict[str, object]) -> None:
    """Render a platform security template and send it. Adapter errors propagate."""
    subject, body = template.render(context)
    get_adapter(NotificationChannel.EMAIL).send(
        RenderedMessage(
            channel=NotificationChannel.EMAIL,
            recipient_address=to,
            subject=subject,
            body=body,
            template_code=template.code,
        )
    )
