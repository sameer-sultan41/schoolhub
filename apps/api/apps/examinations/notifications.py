"""§12's notification triggers for the examinations module.

This PR wires the two §12 rows it can resolve recipients for — a published exam
schedule and an issued admit card — both fanning out to the students sitting the
exam and their portal-enabled guardians.

PR C added `exams.marks-entry-reminder`; PR D adds the last three. **All six
of §12's rows are now wired**, which for this module means all six have a
caller — see below.

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

RESULT_APPROVAL_PENDING = "exams.result-approval-pending"
RESULT_PUBLISHED = "exams.result-published"
REPORT_CARD_READY = "exams.report-card-ready"

_APPROVAL_VARS = {"exam.name", "school.name", "student_count"}
_PUBLISH_VARS = {"exam.name", "school.name"}

catalog.register(
    RESULT_APPROVAL_PENDING,
    template_code=RESULT_APPROVAL_PENDING,
    category=NotificationCategory.EXAMS,
    # High: an exam sits in `processing` until someone approves it, and every
    # downstream step — publishing, report cards — waits behind this one person.
    priority=NotificationPriority.HIGH,
    # In-app only, which is §12's own choice for this row. An approver acts
    # inside the dashboard, and the decision needs the result summary in front
    # of them rather than a link in an inbox.
    channels=set(),
    variables=_APPROVAL_VARS,
    description="Processed results are waiting for an approver's decision.",
)

templates.register(
    RESULT_APPROVAL_PENDING,
    channel=NotificationChannel.IN_APP,
    subject="{{ exam.name }} results are ready for your approval",
    body=(
        "{{ student_count }} processed result(s) for {{ exam.name }} are waiting for "
        "approval. Nothing is published until you approve them.\n\n{{ school.name }}"
    ),
    variables=_APPROVAL_VARS,
)

catalog.register(
    RESULT_PUBLISHED,
    template_code=RESULT_PUBLISHED,
    category=NotificationCategory.EXAMS,
    priority=NotificationPriority.HIGH,
    channels={NotificationChannel.EMAIL},
    variables=_PUBLISH_VARS,
    description="An exam's results have been published to students and guardians.",
)

for _channel in (NotificationChannel.IN_APP, NotificationChannel.EMAIL):
    templates.register(
        RESULT_PUBLISHED,
        channel=_channel,
        subject="{{ exam.name }} results are now available",
        body=(
            # Deliberately no grade in the body. A result is not something to
            # put in an email, and the portal is where a student reads it —
            # which is also the only place record scope applies.
            "The results for {{ exam.name }} have been published. Sign in to the portal "
            "to view them.\n\n{{ school.name }}"
        ),
        variables=_PUBLISH_VARS,
    )

catalog.register(
    REPORT_CARD_READY,
    template_code=REPORT_CARD_READY,
    category=NotificationCategory.EXAMS,
    priority=NotificationPriority.NORMAL,
    channels={NotificationChannel.EMAIL},
    variables=_PUBLISH_VARS,
    description="A report card has been published and is downloadable.",
)

for _channel in (NotificationChannel.IN_APP, NotificationChannel.EMAIL):
    templates.register(
        REPORT_CARD_READY,
        channel=_channel,
        subject="{{ exam.name }} report card is ready",
        body=(
            "The report card for {{ exam.name }} is available to download from the "
            "portal.\n\n{{ school.name }}"
        ),
        variables=_PUBLISH_VARS,
    )
