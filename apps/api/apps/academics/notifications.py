"""Notification triggers and platform default templates — academics.md §12.

Six rows in the module doc; four are registered here and three of those are
emitted: `allocation-changed` from `services.create_allocation`,
`promotion-pending` from `services.submit_batch`, and `promotion-outcome` from
`services.approve_batch` and `services.reject_batch`. The three gaps are listed
rather than silently omitted so they stay greppable:

- `academics.curriculum-approved` has templates but no caller. §4 marks
  `academics.curriculum.approve` a recommendation and there is no sign-off
  action on the curriculum to hang the trigger on yet.
- `academics.promotion-input-request` needs a task/inbox concept to be
  meaningful (§12 sends it to every affected class teacher when a batch opens),
  and there is no assignment surface for a class teacher to act on yet.
- `academics.coverage-gap` is a scheduled T-7 sweep. The beat schedule exists
  now, but the trigger is only useful once a session has a known start date
  being counted down to across tenants; it belongs with the coverage report.

`promotion-outcome` carries a **batch** outcome addressed to the preparer, not
§12's per-student note to guardians. The approval decision is the only outcome
this workflow currently produces — execution's per-student result report has no
guardian-facing counterpart, and inventing a guardian resolution rule this
module does not own would be worse than saying so here.
"""

from core.notifications.catalog import registry as catalog
from core.notifications.models import (
    NotificationCategory,
    NotificationChannel,
    NotificationPriority,
)
from core.notifications.templates import registry as templates

ALLOCATION_CHANGED = "academics.allocation-changed"
CURRICULUM_APPROVED = "academics.curriculum-approved"
PROMOTION_PENDING = "academics.promotion-pending"
PROMOTION_OUTCOME = "academics.promotion-outcome"

_ALLOCATION_VARS = {"teacher.first_name", "section.name", "subject.name", "session.name"}
_CURRICULUM_VARS = {"session.name", "school.name"}
_PENDING_VARS = {"class.name", "student.count", "session.name"}
_OUTCOME_VARS = {"class.name", "student.count", "decision", "session.name"}


catalog.register(
    ALLOCATION_CHANGED,
    template_code=ALLOCATION_CHANGED,
    category=NotificationCategory.ACADEMIC,
    channels={NotificationChannel.EMAIL},
    variables=_ALLOCATION_VARS,
    description="A teacher was assigned to, or removed from, a (section, subject).",
)
templates.register(
    ALLOCATION_CHANGED,
    channel=NotificationChannel.IN_APP,
    subject="Your teaching allocation changed",
    body=(
        "{{ teacher.first_name }}, you are now teaching {{ subject.name }} to "
        "{{ section.name }} for {{ session.name }}."
    ),
    variables=_ALLOCATION_VARS,
)
templates.register(
    ALLOCATION_CHANGED,
    channel=NotificationChannel.EMAIL,
    subject="Your teaching allocation for {{ session.name }}",
    body=(
        "{{ teacher.first_name }}, you are now teaching {{ subject.name }} to "
        "{{ section.name }} for {{ session.name }}."
    ),
    variables=_ALLOCATION_VARS,
)

catalog.register(
    CURRICULUM_APPROVED,
    template_code=CURRICULUM_APPROVED,
    category=NotificationCategory.ACADEMIC,
    variables=_CURRICULUM_VARS,
    description="A session's curriculum was signed off and is now active.",
)
templates.register(
    CURRICULUM_APPROVED,
    channel=NotificationChannel.IN_APP,
    subject="Curriculum approved for {{ session.name }}",
    body="The {{ session.name }} curriculum at {{ school.name }} has been approved.",
    variables=_CURRICULUM_VARS,
)

catalog.register(
    PROMOTION_PENDING,
    template_code=PROMOTION_PENDING,
    category=NotificationCategory.ACADEMIC,
    priority=NotificationPriority.HIGH,
    channels={NotificationChannel.EMAIL},
    variables=_PENDING_VARS,
    description="A promotion batch was submitted and is awaiting approval.",
)
templates.register(
    PROMOTION_PENDING,
    channel=NotificationChannel.IN_APP,
    subject="Promotion batch awaiting your approval",
    body=(
        "{{ class.name }}'s promotion batch for {{ session.name }} "
        "({{ student.count }} students) is ready for approval."
    ),
    variables=_PENDING_VARS,
)
templates.register(
    PROMOTION_PENDING,
    channel=NotificationChannel.EMAIL,
    subject="Promotion batch awaiting approval — {{ class.name }}",
    body=(
        "{{ class.name }}'s promotion batch for {{ session.name }} "
        "({{ student.count }} students) is ready for approval."
    ),
    variables=_PENDING_VARS,
)

catalog.register(
    PROMOTION_OUTCOME,
    template_code=PROMOTION_OUTCOME,
    category=NotificationCategory.ACADEMIC,
    channels={NotificationChannel.EMAIL},
    variables=_OUTCOME_VARS,
    description="A promotion batch was approved, or sent back to its preparer.",
)
templates.register(
    PROMOTION_OUTCOME,
    channel=NotificationChannel.IN_APP,
    subject="Promotion batch {{ decision }}",
    body=(
        "{{ class.name }}'s promotion batch for {{ session.name }} "
        "({{ student.count }} students) was {{ decision }}."
    ),
    variables=_OUTCOME_VARS,
)
templates.register(
    PROMOTION_OUTCOME,
    channel=NotificationChannel.EMAIL,
    subject="Promotion batch {{ decision }} — {{ class.name }}",
    body=(
        "{{ class.name }}'s promotion batch for {{ session.name }} "
        "({{ student.count }} students) was {{ decision }}."
    ),
    variables=_OUTCOME_VARS,
)
