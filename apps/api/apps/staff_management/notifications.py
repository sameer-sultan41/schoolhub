"""Notification triggers and platform default templates owned by this module.

Registered into `core.notifications` at app-ready time, the same way this module's
permission keys and feature flag self-register (see `permissions.py`, `features.py`).
"""

from core.notifications.catalog import registry as catalog
from core.notifications.models import (
    NotificationCategory,
    NotificationChannel,
    NotificationPriority,
)
from core.notifications.templates import registry as templates

STAFF_INVITED = "staff.invited"

INVITE_VARIABLES = {"staff.first_name", "school.name"}

# In-app only, deliberately. The email that lets the person in is the invitation
# itself, sent through core.rbac.auth_emails rather than notify(), because notify()
# persists the rendered body and the link must never be stored (ADR-0033). The inbox
# entry is waiting for them once they accept and sign in.
catalog.register(
    STAFF_INVITED,
    template_code=STAFF_INVITED,
    category=NotificationCategory.GENERAL,
    priority=NotificationPriority.NORMAL,
    channels={NotificationChannel.IN_APP},
    variables=INVITE_VARIABLES,
    description="A staff portal account was created and linked to a staff record.",
)

templates.register(
    STAFF_INVITED,
    channel=NotificationChannel.IN_APP,
    subject="Welcome to {{ school.name }}",
    body=(
        "Hello {{ staff.first_name }}, a staff account has been created for you at "
        "{{ school.name }}. Your school administrator will confirm when it is ready to use."
    ),
    variables=INVITE_VARIABLES,
)
