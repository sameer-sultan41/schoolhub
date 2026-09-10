"""§12's notification triggers this PR wires: an announcement or a notice
being published. The remaining §12 rows (acknowledgment reminder, thread
reply, emergency broadcast, delivery-failure alert, birthday) arrive with
the PRs that produce those events.

Every trigger registered here is called from exactly the `services.py`
function that fires it — `publish_announcement`/`publish_notice` — matching
the rule examinations' PR B review established: a registration with no
caller persists no rows and is worse than not registering it at all.
"""

from core.notifications.catalog import registry as catalog
from core.notifications.models import NotificationCategory, NotificationChannel
from core.notifications.templates import registry as templates

ANNOUNCEMENT_PUBLISHED = "communication.announcement-published"
NOTICE_PUBLISHED = "communication.notice-published"

_ANNOUNCEMENT_VARS = {"announcement.title", "announcement.body"}
_NOTICE_VARS = {"notice.notice_no", "notice.title", "notice.body"}

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
