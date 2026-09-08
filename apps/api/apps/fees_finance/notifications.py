"""§12's notification triggers for the fees-finance module.

This PR wires the three §12 rows invoicing can resolve recipients for: an
issued invoice, a due-date reminder, and an overdue notice with its late fee.
The receipt, refund, expense and payroll rows arrive with the PRs that produce
those events.

**Every trigger registered here is called from somewhere.** Examinations' PR B
review found a trigger registered with templates, documented as wired, and
called from nowhere — a catalogue entry that persisted no rows. A registration
with no caller is worse than an omission, because the doc then claims a
capability the code does not have. So the registrations here are exactly the
three `tasks.py` sends.

Recipients are a student's guardians with a live, portal-enabled link — the same
gate `Student.filter_owned_by_user` applies to reads. A guardian whose access
was revoked must not keep receiving fee notices about a child they can no longer
see.

`NotificationCategory.FEES` already exists in `core/notifications/models.py`, so
no catalogue change ships with this module.
"""

from core.notifications.catalog import registry as catalog
from core.notifications.models import (
    NotificationCategory,
    NotificationChannel,
    NotificationPriority,
)
from core.notifications.templates import registry as templates

INVOICE_ISSUED = "fees.invoice-issued"
DUE_REMINDER = "fees.due-reminder"
OVERDUE = "fees.overdue"

_INVOICE_VARS = {
    "school.name",
    "student.first_name",
    "invoice_no",
    "amount",
    "due_date",
    "period",
}
_OVERDUE_VARS = {"school.name", "student.first_name", "invoice_no", "amount", "due_date"}

catalog.register(
    INVOICE_ISSUED,
    template_code=INVOICE_ISSUED,
    category=NotificationCategory.FEES,
    # Normal, unlike the overdue notice below. An invoice arriving on schedule
    # is expected correspondence; treating it as high priority would train
    # guardians to ignore the priority flag by the time something is urgent.
    priority=NotificationPriority.NORMAL,
    channels={NotificationChannel.EMAIL},
    variables=_INVOICE_VARS,
    description="A fee invoice has been issued and is payable from the portal.",
)

for _channel in (NotificationChannel.IN_APP, NotificationChannel.EMAIL):
    templates.register(
        INVOICE_ISSUED,
        channel=_channel,
        subject="Fee invoice {{ invoice_no }} for {{ period }}",
        body=(
            "{{ student.first_name }}'s fee invoice for {{ period }} is now available. "
            "Amount due {{ amount }}, payable by {{ due_date }}.\n\n"
            "You can view the breakdown and pay from the parent portal.\n\n"
            "{{ school.name }}"
        ),
        variables=_INVOICE_VARS,
    )

catalog.register(
    DUE_REMINDER,
    template_code=DUE_REMINDER,
    category=NotificationCategory.FEES,
    priority=NotificationPriority.NORMAL,
    channels={NotificationChannel.EMAIL},
    variables=_OVERDUE_VARS,
    description="A fee invoice falls due shortly (§12's T-7/T-1 reminder).",
)

for _channel in (NotificationChannel.IN_APP, NotificationChannel.EMAIL):
    templates.register(
        DUE_REMINDER,
        channel=_channel,
        subject="Reminder: fee invoice {{ invoice_no }} due {{ due_date }}",
        body=(
            "A reminder that {{ amount }} remains due on {{ student.first_name }}'s "
            "invoice {{ invoice_no }}, payable by {{ due_date }}.\n\n"
            "{{ school.name }}"
        ),
        variables=_OVERDUE_VARS,
    )

catalog.register(
    OVERDUE,
    template_code=OVERDUE,
    category=NotificationCategory.FEES,
    # High: a late fee has been added to what the family owes, so this notice
    # tells them something changed rather than merely reminding them.
    priority=NotificationPriority.HIGH,
    channels={NotificationChannel.EMAIL},
    variables=_OVERDUE_VARS,
    description="A fee invoice is past its due date and a late fee may have been applied.",
)

for _channel in (NotificationChannel.IN_APP, NotificationChannel.EMAIL):
    templates.register(
        OVERDUE,
        channel=_channel,
        subject="Overdue: fee invoice {{ invoice_no }}",
        body=(
            "{{ student.first_name }}'s invoice {{ invoice_no }} was due on "
            "{{ due_date }} and {{ amount }} is outstanding. A late fee may have "
            "been added in line with the school's fee policy.\n\n"
            "{{ school.name }}"
        ),
        variables=_OVERDUE_VARS,
    )


PAYMENT_RECEIPT = "fees.payment-receipt"
REFUND_STATUS = "fees.refund-status"

_RECEIPT_VARS = {"school.name", "student.first_name", "receipt_no", "amount", "invoice_no"}
_REFUND_VARS = {"school.name", "student.first_name", "amount", "status", "reason"}

catalog.register(
    PAYMENT_RECEIPT,
    template_code=PAYMENT_RECEIPT,
    category=NotificationCategory.FEES,
    # Normal: money arriving safely is reassuring rather than urgent, and a
    # school that marks every fee message high trains guardians to ignore the
    # flag by the time something actually is.
    priority=NotificationPriority.NORMAL,
    channels={NotificationChannel.EMAIL},
    variables=_RECEIPT_VARS,
    description="A payment has been received and its receipt is available.",
)

for _channel in (NotificationChannel.IN_APP, NotificationChannel.EMAIL):
    templates.register(
        PAYMENT_RECEIPT,
        channel=_channel,
        subject="Receipt {{ receipt_no }} for {{ amount }}",
        body=(
            "We have received {{ amount }} towards {{ student.first_name }}'s "
            "invoice {{ invoice_no }}. Receipt {{ receipt_no }} is available in "
            "the parent portal.\n\n"
            "{{ school.name }}"
        ),
        variables=_RECEIPT_VARS,
    )

catalog.register(
    REFUND_STATUS,
    template_code=REFUND_STATUS,
    category=NotificationCategory.FEES,
    priority=NotificationPriority.NORMAL,
    channels={NotificationChannel.EMAIL},
    variables=_REFUND_VARS,
    description="A refund request has been decided or processed (§7.3).",
)

for _channel in (NotificationChannel.IN_APP, NotificationChannel.EMAIL):
    templates.register(
        REFUND_STATUS,
        channel=_channel,
        subject="Refund update for {{ student.first_name }}",
        body=(
            "The refund of {{ amount }} for {{ student.first_name }} is now "
            "{{ status }}.\n\n{{ reason }}\n\n{{ school.name }}"
        ),
        variables=_REFUND_VARS,
    )
