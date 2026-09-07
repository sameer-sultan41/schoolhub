"""§12's notification triggers for the examinations module.

This PR wires the two §12 rows it can resolve recipients for — a published exam
schedule and an issued admit card — both fanning out to the students sitting the
exam and their portal-enabled guardians.

The remaining four wait on the PRs that create the thing being announced:
`exams.marks-entry-reminder` needs `marks` and an entry window with something
missing from it (PR C); `exams.result-approval-pending`, `exams.result-published`
and `exams.report-card-ready` need `results` and `report_cards` (PR D). Naming
them here rather than leaving them absent is the same practice
`timetable/notifications.py` follows for its two deferred rows.

`NotificationCategory.EXAMS` already exists in `core/notifications/models.py`, so
no catalogue change ships with this module.
"""

from core.notifications.catalog import registry as catalog
from core.notifications.models import (
    NotificationCategory,
    NotificationChannel,
    NotificationPriority,
)
from core.notifications.templates import registry as templates

SCHEDULE_PUBLISHED = "exams.schedule-published"
ADMIT_CARD_ISSUED = "exams.admit-card-issued"

_SCHEDULE_VARS = {"exam.name", "school.name", "starts_on"}
_ADMIT_CARD_VARS = {"exam.name", "school.name", "student.first_name", "admit_card_no"}

catalog.register(
    SCHEDULE_PUBLISHED,
    template_code=SCHEDULE_PUBLISHED,
    category=NotificationCategory.EXAMS,
    # High, not normal: a student who misses the announcement misses a paper.
    # §12 puts this on push, in-app and email for the same reason.
    priority=NotificationPriority.HIGH,
    channels={NotificationChannel.EMAIL},
    variables=_SCHEDULE_VARS,
    description="An exam timetable has been published to students and guardians.",
)

for _channel in (NotificationChannel.IN_APP, NotificationChannel.EMAIL):
    templates.register(
        SCHEDULE_PUBLISHED,
        channel=_channel,
        subject="{{ exam.name }} timetable is now available",
        body=(
            "The timetable for {{ exam.name }} has been published and starts "
            "{{ starts_on }}. Check the portal for each paper's date, time and room.\n\n"
            "{{ school.name }}"
        ),
        variables=_SCHEDULE_VARS,
    )

catalog.register(
    ADMIT_CARD_ISSUED,
    template_code=ADMIT_CARD_ISSUED,
    category=NotificationCategory.EXAMS,
    priority=NotificationPriority.HIGH,
    channels={NotificationChannel.EMAIL},
    variables=_ADMIT_CARD_VARS,
    description="An admit card has been issued and is downloadable from the portal.",
)

for _channel in (NotificationChannel.IN_APP, NotificationChannel.EMAIL):
    templates.register(
        ADMIT_CARD_ISSUED,
        channel=_channel,
        subject="Admit card for {{ exam.name }}",
        body=(
            "{{ student.first_name }}'s admit card for {{ exam.name }} is ready. "
            "Card number {{ admit_card_no }}. It must be brought to every paper.\n\n"
            "{{ school.name }}"
        ),
        variables=_ADMIT_CARD_VARS,
    )
