"""Notification triggers and platform default templates — attendance.md §12.

Six rows in the module doc; two are wired here. The four that are not, and what
each waits on:

- `attendance.leave-submitted` and `attendance.leave-decision` need
  `leave_requests` to exist, which is this module's second PR.
- `attendance.correction-decision` is deliberately **not** wired even though the
  correction flow ships in this PR. §12 sends it to the correction's requester,
  who is a member of staff acting inside the dashboard — and unlike the guardian
  alerts below, there is no off-platform recipient to reach. It waits on the
  in-app inbox surface rather than on any backend piece; adding the trigger now
  would persist rows nothing renders.
- `attendance.chronic-absence` needs the threshold query §13's defaulter report
  provides, which ships with the reports PR. A trigger with no way to detect its
  own condition is a row in a catalog, not a notification.

The two that are wired are the ones with a real recipient outside the building:
a guardian who does not know their child is absent is the safeguarding case §2
names, and it is the module's whole reason for existing.
"""

from core.notifications.catalog import registry as catalog
from core.notifications.models import (
    NotificationCategory,
    NotificationChannel,
    NotificationPriority,
)
from core.notifications.templates import registry as templates

ABSENCE_ALERT = "attendance.absence-alert"
LATE_ALERT = "attendance.late-alert"

_ALERT_VARS = {"student.first_name", "date", "school.name"}

catalog.register(
    ABSENCE_ALERT,
    template_code=ABSENCE_ALERT,
    category=NotificationCategory.ATTENDANCE,
    # HIGH, and it is the only attendance trigger that is: §2 measures this
    # module by whether guardians hear about an unexplained absence *the same
    # morning*. A same-day alert that arrives tomorrow has failed.
    priority=NotificationPriority.HIGH,
    channels={NotificationChannel.EMAIL},
    variables=_ALERT_VARS,
    description="A student was marked absent with no approved leave.",
)
for _channel in (NotificationChannel.IN_APP, NotificationChannel.EMAIL):
    templates.register(
        ABSENCE_ALERT,
        channel=_channel,
        subject="{{ student.first_name }} was marked absent today",
        body=(
            "{{ student.first_name }} was marked absent at {{ school.name }} on "
            "{{ date }}. If this is wrong, or if they are unwell, please contact "
            "the school office."
        ),
        variables=_ALERT_VARS,
    )

catalog.register(
    LATE_ALERT,
    template_code=LATE_ALERT,
    category=NotificationCategory.ATTENDANCE,
    variables=_ALERT_VARS,
    description="A student arrived late.",
)
templates.register(
    LATE_ALERT,
    channel=NotificationChannel.IN_APP,
    subject="{{ student.first_name }} arrived late",
    body="{{ student.first_name }} was marked late at {{ school.name }} on {{ date }}.",
    variables=_ALERT_VARS,
)
