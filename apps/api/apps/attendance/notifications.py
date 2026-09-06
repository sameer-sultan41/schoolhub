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

What the four wired ones have in common is a recipient who is not already
looking at the answer: a guardian who does not know their child is absent is the
safeguarding case §2 names, and a guardian waiting on a leave decision has no
other way to learn of it.
"""

import logging

from core.notifications.catalog import registry as catalog
from core.notifications.models import (
    NotificationCategory,
    NotificationChannel,
    NotificationPriority,
)
from core.notifications.templates import registry as templates

logger = logging.getLogger(__name__)

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


LEAVE_SUBMITTED = "attendance.leave-submitted"
LEAVE_DECISION = "attendance.leave-decision"

_SUBMITTED_VARS = {"student.first_name", "leave_type.name", "start_date", "end_date"}
_DECISION_VARS = {"student.first_name", "start_date", "end_date", "decision"}

catalog.register(
    LEAVE_SUBMITTED,
    template_code=LEAVE_SUBMITTED,
    category=NotificationCategory.ATTENDANCE,
    channels={NotificationChannel.EMAIL},
    variables=_SUBMITTED_VARS,
    description="A student leave request is waiting on an approver at the current step.",
)
for _channel in (NotificationChannel.IN_APP, NotificationChannel.EMAIL):
    templates.register(
        LEAVE_SUBMITTED,
        channel=_channel,
        subject="Leave request for {{ student.first_name }}",
        body=(
            "{{ student.first_name }} has requested {{ leave_type.name }} from "
            "{{ start_date }} to {{ end_date }} and is waiting on your decision."
        ),
        variables=_SUBMITTED_VARS,
    )

catalog.register(
    LEAVE_DECISION,
    template_code=LEAVE_DECISION,
    category=NotificationCategory.ATTENDANCE,
    channels={NotificationChannel.EMAIL},
    variables=_DECISION_VARS,
    description="A student leave request was approved or rejected.",
)
for _channel in (NotificationChannel.IN_APP, NotificationChannel.EMAIL):
    templates.register(
        LEAVE_DECISION,
        channel=_channel,
        subject="Leave for {{ student.first_name }} was {{ decision }}",
        body=(
            "The request for {{ student.first_name }} covering {{ start_date }} to "
            "{{ end_date }} was {{ decision }}."
        ),
        variables=_DECISION_VARS,
    )


def notify_leave_submitted(*, request) -> None:
    """Tell whoever can decide the request's *current* step.

    Recipients are resolved by permission key rather than by role name: §7.2's
    chain stores `required_permission` on the step precisely so the answer to
    "who decides this" survives a tenant editing its roles. `class_teacher`,
    `vice_principal` and `principal` all hold the same key (§4) — record scope,
    not the key, is what makes level 1 the class teacher's in practice.

    A step with no eligible approver is logged by the caller rather than raised
    on: a school with nobody holding the key has a configuration problem, and
    failing the guardian's submission would not fix it.
    """
    from core.notifications.services import Recipient, notify
    from core.rbac.models import RolePermission, UserRole

    step = request.approvals.alive().filter(level=request.current_approval_level).first()
    if step is None:
        return

    role_ids = RolePermission.objects.filter(
        permission__key=step.required_permission, role__deleted_at__isnull=True
    ).values_list("role_id", flat=True)
    user_ids = set(
        UserRole.objects.filter(role_id__in=role_ids, deleted_at__isnull=True)
        .exclude(user_id=request.submitted_by)
        .values_list("user_id", flat=True)
    )
    if not user_ids:
        # Documented behaviour that was a silent `return`. A school with nobody
        # holding the step's key has a configuration problem the *approver queue*
        # will never show — the request sits pending and no one is told — so the
        # log line is the only place it surfaces.
        logger.warning(
            "leave request %s has no eligible approver for %r at level %s",
            request.pk,
            step.required_permission,
            step.level,
        )
        return

    notify(
        LEAVE_SUBMITTED,
        tenant_id=request.tenant_id,
        recipients=[Recipient(user_id=user_id) for user_id in user_ids],
        context={
            "student.first_name": request.student.first_name,
            "leave_type.name": request.leave_type.name,
            "start_date": request.start_date.isoformat(),
            "end_date": request.end_date.isoformat(),
        },
        source_type="leave_request",
        source_id=request.pk,
    )


def notify_leave_decision(*, request) -> None:
    """Tell the submitter. §12 names the requester, not the student.

    The submitter is often a guardian acting for a child who has no portal
    account at all, so addressing the student would reach nobody — the row
    already records who asked.
    """
    from core.notifications.services import Recipient, notify

    notify(
        LEAVE_DECISION,
        tenant_id=request.tenant_id,
        recipients=[Recipient(user_id=request.submitted_by)],
        context={
            "student.first_name": request.student.first_name,
            "start_date": request.start_date.isoformat(),
            "end_date": request.end_date.isoformat(),
            "decision": request.status,
        },
        source_type="leave_request",
        source_id=request.pk,
    )
