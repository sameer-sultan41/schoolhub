"""Notification triggers and platform default templates — timetable.md §12.

Five rows in the module doc; three are wired. The two that are not:

- `timetable.class-substitution` needs every student and guardian of a section as
  recipients, and resolving that fan-out belongs with the recipient-rule work in
  the communication module rather than a hand-rolled query here.
- `timetable.validation-failed` is an in-app notice to the publisher, who is the
  person making the request and already receives the conflict list in the 422
  response body. A notification would tell them what they are already reading.
"""

from core.notifications.catalog import registry as catalog
from core.notifications.models import (
    NotificationCategory,
    NotificationChannel,
    NotificationPriority,
)
from core.notifications.templates import registry as templates

PUBLISHED = "timetable.published"
SUBSTITUTION_ASSIGNED = "timetable.substitution-assigned"
SUBSTITUTION_DECISION = "timetable.substitution-decision"

_PUBLISHED_VARS = {"section.name", "session.name"}
_ASSIGNED_VARS = {"substitute.first_name", "section.name", "date", "period.name"}
_DECISION_VARS = {"section.name", "date", "decision"}

catalog.register(
    PUBLISHED,
    template_code=PUBLISHED,
    category=NotificationCategory.ACADEMIC,
    variables=_PUBLISHED_VARS,
    description="A section's timetable was published or republished.",
)
templates.register(
    PUBLISHED,
    channel=NotificationChannel.IN_APP,
    subject="Timetable published for {{ section.name }}",
    body="The {{ session.name }} timetable for {{ section.name }} is now published.",
    variables=_PUBLISHED_VARS,
)

catalog.register(
    SUBSTITUTION_ASSIGNED,
    template_code=SUBSTITUTION_ASSIGNED,
    category=NotificationCategory.ACADEMIC,
    priority=NotificationPriority.HIGH,
    channels={NotificationChannel.EMAIL},
    variables=_ASSIGNED_VARS,
    description="A teacher was assigned to cover someone else's period.",
)
for _channel in (NotificationChannel.IN_APP, NotificationChannel.EMAIL):
    templates.register(
        SUBSTITUTION_ASSIGNED,
        channel=_channel,
        subject="You are covering {{ section.name }} on {{ date }}",
        body=(
            "{{ substitute.first_name }}, you are covering {{ section.name }} "
            "during {{ period.name }} on {{ date }}."
        ),
        variables=_ASSIGNED_VARS,
    )

catalog.register(
    SUBSTITUTION_DECISION,
    template_code=SUBSTITUTION_DECISION,
    category=NotificationCategory.ACADEMIC,
    variables=_DECISION_VARS,
    description="A proposed substitution was approved or declined.",
)
templates.register(
    SUBSTITUTION_DECISION,
    channel=NotificationChannel.IN_APP,
    subject="Substitution {{ decision }}",
    body="Your substitution for {{ section.name }} on {{ date }} was {{ decision }}.",
    variables=_DECISION_VARS,
)
