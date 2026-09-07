"""§12's notification triggers for the examinations module.

This PR wires the two §12 rows it can resolve recipients for — a published exam
schedule and an issued admit card — both fanning out to the students sitting the
exam and their portal-enabled guardians.

PR C adds `exams.marks-entry-reminder`. The remaining three —
`exams.result-approval-pending`, `exams.result-published` and
`exams.report-card-ready` — wait on `results` and `report_cards` (PR D). Naming
them here rather than leaving them absent is the same practice
`timetable/notifications.py` follows for its two deferred rows.

**Every trigger registered here is called from somewhere.** PR B's review found
`exams.admit-card-issued` registered with templates, documented as wired, and
called from nowhere — a catalogue entry that persisted no rows. A registration
with no caller is worse than an omission, because the doc then claims a
capability the code does not have.

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

MARKS_ENTRY_REMINDER = "exams.marks-entry-reminder"

_REMINDER_VARS = {
    "exam.name",
    "school.name",
    "subject.name",
    "class.name",
    "outstanding",
    "closes_at",
}

catalog.register(
    MARKS_ENTRY_REMINDER,
    template_code=MARKS_ENTRY_REMINDER,
    category=NotificationCategory.EXAMS,
    # Normal, not high: this is a deadline two days out, not something a
    # recipient has to act on within the hour. §12 puts it on in-app and email
    # only, with no push, which is the same judgement.
    priority=NotificationPriority.NORMAL,
    channels={NotificationChannel.EMAIL},
    variables=_REMINDER_VARS,
    description="A teacher still has marks outstanding as an entry window closes.",
)

for _channel in (NotificationChannel.IN_APP, NotificationChannel.EMAIL):
    templates.register(
        MARKS_ENTRY_REMINDER,
        channel=_channel,
        subject="{{ outstanding }} marks still to enter for {{ subject.name }}",
        body=(
            "{{ class.name }} {{ subject.name }} has {{ outstanding }} student(s) with no "
            "submitted marks for {{ exam.name }}. Entry closes {{ closes_at }}.\n\n"
            "{{ school.name }}"
        ),
        variables=_REMINDER_VARS,
    )
