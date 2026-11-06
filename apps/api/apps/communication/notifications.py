"""§12's notification triggers wired so far: an announcement or a notice
being published, a reply in a message thread, and an emergency broadcast. The
remaining §12 rows (acknowledgment reminder, delivery-failure alert, birthday)
arrive with the PRs that produce those events.

Every trigger registered here is called from exactly the one `services/`
function that fires it — `announcements.services.publish.publish_announcement`/
`notices.services.publish.publish_notice`/
`threads.services.post_message.post_message`/
`tasks.send_emergency_broadcast_task` — matching the rule examinations'
PR B review established: a registration with no caller persists no rows and
is worse than not registering it at all.
"""

from core.notifications.catalog import registry as catalog
from core.notifications.models import (
    NotificationCategory,
    NotificationChannel,
    NotificationPriority,
)
from core.notifications.templates import registry as templates

ANNOUNCEMENT_PUBLISHED = "communication.announcement-published"
NOTICE_PUBLISHED = "communication.notice-published"
THREAD_REPLY = "communication.thread-reply"
EMERGENCY_BROADCAST = "communication.emergency-broadcast"

_ANNOUNCEMENT_VARS = {"announcement.title", "announcement.body"}
_NOTICE_VARS = {"notice.notice_no", "notice.title", "notice.body"}
_THREAD_REPLY_VARS = {"thread.subject", "message.sender_name", "message.preview"}
_EMERGENCY_BROADCAST_VARS = {"broadcast.message"}

catalog.register(
    ANNOUNCEMENT_PUBLISHED,
    template_code=ANNOUNCEMENT_PUBLISHED,
    category=NotificationCategory.GENERAL,
    # push has no adapter yet — declaring it anyway is correct per
    # core/notifications/adapters.py's own framing: a trigger that promises a
    # channel its module doc lists records `skipped` with a named reason,
    # rather than quietly delivering on fewer channels than §12 promises.
    channels={NotificationChannel.IN_APP, NotificationChannel.PUSH},
    variables=_ANNOUNCEMENT_VARS,
    description="An announcement has been published.",
)
for _channel in (NotificationChannel.IN_APP, NotificationChannel.PUSH):
    templates.register(
        ANNOUNCEMENT_PUBLISHED,
        channel=_channel,
        subject="{{ announcement.title }}",
        body="{{ announcement.body }}",
        variables=_ANNOUNCEMENT_VARS,
    )

catalog.register(
    NOTICE_PUBLISHED,
    template_code=NOTICE_PUBLISHED,
    category=NotificationCategory.GENERAL,
    channels={
        NotificationChannel.IN_APP,
        NotificationChannel.EMAIL,
        NotificationChannel.SMS,
        NotificationChannel.PUSH,
    },
    variables=_NOTICE_VARS,
    description="A formal notice has been published.",
)
for _channel in (NotificationChannel.IN_APP, NotificationChannel.EMAIL, NotificationChannel.PUSH):
    templates.register(
        NOTICE_PUBLISHED,
        channel=_channel,
        subject="Notice {{ notice.notice_no }}: {{ notice.title }}",
        body="{{ notice.body }}",
        variables=_NOTICE_VARS,
    )
# SMS has no subject concept — `TemplateRegistry.register` refuses a `subject`
# for this channel, the same rule
# `template_overrides.services.validate.assert_override_is_valid` mirrors for
# tenant overrides.
templates.register(
    NOTICE_PUBLISHED,
    channel=NotificationChannel.SMS,
    body="Notice {{ notice.notice_no }}: {{ notice.title }}",
    variables=_NOTICE_VARS,
)

catalog.register(
    THREAD_REPLY,
    template_code=THREAD_REPLY,
    category=NotificationCategory.GENERAL,
    channels={NotificationChannel.IN_APP, NotificationChannel.PUSH},
    variables=_THREAD_REPLY_VARS,
    description="A new message in a thread one takes part in.",
)
for _channel in (NotificationChannel.IN_APP, NotificationChannel.PUSH):
    templates.register(
        THREAD_REPLY,
        channel=_channel,
        subject="{{ thread.subject }}",
        body="{{ message.sender_name }}: {{ message.preview }}",
        variables=_THREAD_REPLY_VARS,
    )

# §12: "all channels", preferences bypassed. The bypass is the `emergency`
# category itself — `core.notifications.services.notify` never consults the
# preference resolver for it — so nothing here, or in the task, re-implements it.
# SMS, push and WhatsApp have no adapter yet; the preview reports them as
# `unavailable_channels` and their deliveries are recorded `skipped`.
EMERGENCY_BROADCAST_TRIGGER = catalog.register(
    EMERGENCY_BROADCAST,
    template_code=EMERGENCY_BROADCAST,
    category=NotificationCategory.EMERGENCY,
    priority=NotificationPriority.EMERGENCY,
    channels={
        NotificationChannel.IN_APP,
        NotificationChannel.EMAIL,
        NotificationChannel.SMS,
        NotificationChannel.PUSH,
        NotificationChannel.WHATSAPP,
    },
    variables=_EMERGENCY_BROADCAST_VARS,
    description="An emergency broadcast from the school.",
)
for _channel in (NotificationChannel.IN_APP, NotificationChannel.EMAIL, NotificationChannel.PUSH):
    templates.register(
        EMERGENCY_BROADCAST,
        channel=_channel,
        subject="Emergency alert",
        body="{{ broadcast.message }}",
        variables=_EMERGENCY_BROADCAST_VARS,
    )
# Subjectless, so the body itself says what it is.
for _channel in (NotificationChannel.SMS, NotificationChannel.WHATSAPP):
    templates.register(
        EMERGENCY_BROADCAST,
        channel=_channel,
        body="Emergency: {{ broadcast.message }}",
        variables=_EMERGENCY_BROADCAST_VARS,
    )
