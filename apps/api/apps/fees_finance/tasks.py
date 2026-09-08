"""Background work for the fees-finance module.

Two shapes, both established by `attendance` and `examinations`:

* **A 202 + job endpoint's worker.** `generate_invoices_task` runs a billing run
  and records its outcome on the job row. It **never re-raises** —
  `mark_failed(job=job, error=...)` is the only place a caller polling
  `GET /jobs/{id}` can learn it failed, so a propagated exception would leave
  the job stuck at `running` forever.
* **A nightly per-tenant sweep.** `send_fee_reminders` walks tenants through
  `for_each_tenant` rather than issuing one cross-tenant query: under RLS an
  unbound read does not raise, it silently matches zero rows, so the sweep shape
  is what makes it do anything at all.

Notifications go out **one `notify()` call per invoice, grouped by student** —
not one call for a whole run's recipient list. `notify()` renders its template
body once from the single context it is given and persists that identical body
to every recipient in the call, so a batch that shared one call across many
families would render one family's child and invoice number into every other
family's notice. Per-invoice is still bulk relative to guardians: `notify()`'s
own two bulk writes cover every guardian linked to that one student in a single
pair of round trips, so the cost scales with invoices billed, not with total
guardians reached.
"""

from __future__ import annotations

import datetime
import logging
import uuid

from celery import shared_task

from apps.fees_finance import notifications
from apps.fees_finance.models import FeeInvoice, InvoiceStatus
from core.jobs.models import BackgroundJob
from core.jobs.services import mark_failed, mark_running, mark_succeeded
from core.money import ZERO
from core.tenancy.maintenance import for_each_tenant
from core.tenancy.tasks import TenantAwareTask

logger = logging.getLogger(__name__)

#: How far ahead of a due date the reminder sweep looks. §12 says "T-7/T-1,
#: configurable"; these are the defaults, and a tenant overrides them through
#: `TenantSettings.finance["reminder_days"]`.
DEFAULT_REMINDER_DAYS = (7, 1)

#: Invoice statuses that still owe money. `draft` is excluded on purpose — a
#: draft has not been given to a parent, so reminding them about it would be
#: the first they had heard of the charge.
OUTSTANDING_STATUSES = (
    InvoiceStatus.ISSUED,
    InvoiceStatus.PARTIALLY_PAID,
    InvoiceStatus.OVERDUE,
)


@shared_task(base=TenantAwareTask, bind=True)
def generate_invoices_task(self, *, tenant_id: str, job_id: str, actor_id: str) -> None:
    """§16's `POST /fee-invoices:generate` — the whole run, off the request path.

    A term's billing for a 2000-student school is not work an accountant should
    watch a spinner for, and §7.1 makes generation a background job for exactly
    that reason.
    """
    from apps.fees_finance import services
    from apps.fees_finance.models import FeeStructure
    from apps.school_organization.models import Term
    from core.tenancy.context import tenant_atomic

    with tenant_atomic(uuid.UUID(tenant_id)):
        job = BackgroundJob.objects.get(pk=job_id)
    mark_running(job=job)

    try:
        with tenant_atomic(uuid.UUID(tenant_id)):
            payload = job.payload
            structure = FeeStructure.objects.select_related("academic_session").get(
                pk=payload["fee_structure_id"]
            )
            term = Term.objects.get(pk=payload["term_id"]) if payload.get("term_id") else None
            result = services.generate_invoices(
                structure=structure,
                period_start=(
                    datetime.date.fromisoformat(payload["period_start"])
                    if payload.get("period_start")
                    else None
                ),
                term=term,
                actor_id=uuid.UUID(actor_id),
                tenant_id=uuid.UUID(tenant_id),
            )
        _notify_issued(
            tenant_id=uuid.UUID(tenant_id), invoice_ids=[r["invoice_id"] for r in result["rows"]]
        )
        mark_succeeded(job=job, result=result)
    except Exception as exc:  # noqa: BLE001 — see the module docstring.
        mark_failed(job=job, error=str(exc))


def _recipients_for(invoices: list[FeeInvoice]) -> tuple[list, dict]:
    """Guardians with live portal access, plus each invoice's context.

    The portal gate matches `Student.filter_owned_by_user`: a guardian whose
    access was revoked stops receiving fee notices, not just fee reads. Two
    queries for the whole batch — one for the links, one for the students.
    """
    from apps.student_management.models import StudentGuardian
    from core.notifications.services import Recipient

    student_ids = {invoice.student_id for invoice in invoices}
    links = (
        StudentGuardian.objects.alive()
        .filter(student_id__in=student_ids, has_portal_access=True)
        .select_related("guardian")
    )

    users_by_student: dict = {}
    for link in links:
        user_id = getattr(link.guardian, "user_id", None)
        if user_id:
            users_by_student.setdefault(link.student_id, []).append(user_id)

    recipients = []
    for invoice in invoices:
        for user_id in users_by_student.get(invoice.student_id, []):
            recipients.append(Recipient(user_id=user_id))
    return recipients, users_by_student


def _notify_issued(*, tenant_id: uuid.UUID, invoice_ids: list[str]) -> int:
    """§12's `fees.invoice-issued` — one `notify()` call per invoice.

    **Not one call for the whole run.** `notify()` renders its template body
    exactly once from the single `context` it is given, then persists that
    identical body to every recipient in the call — it has no notion of
    per-recipient variables. A batch of thirty invoices sharing one call and
    one context (built from the first invoice) meant twenty-nine of thirty
    families received a notice naming a different family's child, invoice
    number and amount: the fan-out this file's own module docstring warns
    against, reintroduced at the wrong granularity. An invoice-issued notice is
    inherently per-family content, unlike a genuinely shared announcement (a
    published timetable), so it cannot share a rendering the way that can.

    Grouped by student, not by recipient: a family with two guardians linked to
    one child still gets one `notify()` call covering both, which is what keeps
    the write cost proportional to invoices billed rather than to guardians
    reached.
    """
    from core.notifications.services import Recipient, notify
    from core.tenancy.context import tenant_atomic
    from core.tenancy.models import Tenant

    if not invoice_ids:
        return 0

    notified = 0
    with tenant_atomic(tenant_id):
        invoices = list(FeeInvoice.objects.filter(pk__in=invoice_ids).select_related("student"))
        if not invoices:
            return 0
        _, users_by_student = _recipients_for(invoices)
        school = Tenant.objects.get(pk=tenant_id)

        for invoice in invoices:
            recipients = [
                Recipient(user_id=user_id)
                for user_id in users_by_student.get(invoice.student_id, [])
            ]
            if not recipients:
                continue
            notify(
                notifications.INVOICE_ISSUED,
                tenant_id=tenant_id,
                recipients=recipients,
                context={
                    "school": {"name": school.name},
                    "student": {"first_name": invoice.student.first_name},
                    "invoice_no": invoice.invoice_no,
                    "amount": str(invoice.balance_due),
                    "due_date": invoice.due_date.isoformat(),
                    "period": invoice.period_label or invoice.issue_date.strftime("%Y-%m"),
                },
                source_type="fee_invoice",
                source_id=invoice.pk,
            )
            notified += len(recipients)
    return notified


@shared_task
def send_fee_reminders() -> dict[str, int]:
    """Nightly, tenant by tenant. §12's due reminder and overdue notice.

    Through `for_each_tenant` rather than one cross-tenant query: under RLS an
    unbound write does not raise, it silently matches zero rows, so the sweep
    shape is what makes this do anything at all. It also supplies each tenant's
    transaction and keeps one tenant's bad data from aborting the rest.
    """
    return for_each_tenant(remind_tenant_invoices, job="fees-reminders")


def remind_tenant_invoices(tenant_id: uuid.UUID) -> int:
    """One tenant's reminders and overdue transitions. Returns rows acted on.

    Called inside `tenant_atomic` by `for_each_tenant`, so it opens no
    transaction of its own — `SET LOCAL` is already bound and a nested atomic
    would only add a savepoint.

    The overdue notice fires **on the change of status**, not on the current
    one. Alerting on current status is the bug attendance's review found: a
    retried sweep re-sent every guardian the same message. Here the `UPDATE` to
    `overdue` and the notification sit in the same transaction, and only
    invoices that actually moved are notified.
    """
    from django.utils import timezone

    from core.notifications.services import notify
    from core.tenancy.models import Tenant

    tenant = Tenant.objects.get(pk=tenant_id)
    today = timezone.localdate()
    acted = 0

    for offset in _reminder_days(tenant):
        target = today + datetime.timedelta(days=offset)
        due_soon = list(
            FeeInvoice.objects.filter(
                due_date=target, status__in=OUTSTANDING_STATUSES, balance_due__gt=ZERO
            ).select_related("student")
        )
        if _send_batch(
            tenant=tenant, invoices=due_soon, event=notifications.DUE_REMINDER, notify=notify
        ):
            acted += len(due_soon)

    newly_overdue = list(
        FeeInvoice.objects.filter(
            due_date__lt=today,
            status__in=(InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID),
            balance_due__gt=ZERO,
        ).select_related("student")
    )
    if newly_overdue:
        FeeInvoice.objects.filter(pk__in=[i.pk for i in newly_overdue]).update(
            status=InvoiceStatus.OVERDUE, updated_at=timezone.now()
        )
        _send_batch(
            tenant=tenant, invoices=newly_overdue, event=notifications.OVERDUE, notify=notify
        )
        acted += len(newly_overdue)

    return acted


def _reminder_days(tenant) -> tuple[int, ...]:
    """§12 calls the reminder offsets configurable; this is where that lands."""
    from core.tenancy.models import TenantSettings

    settings = TenantSettings.objects.filter(tenant_id=tenant.pk).first()
    finance = (settings.finance if settings else None) or {}
    days = finance.get("reminder_days")
    if not isinstance(days, list) or not days:
        return DEFAULT_REMINDER_DAYS
    valid = tuple(int(day) for day in days if isinstance(day, int) and day >= 0)
    return valid or DEFAULT_REMINDER_DAYS


def _send_batch(*, tenant, invoices: list[FeeInvoice], event: str, notify) -> int:
    """One `notify()` call per invoice, for the reason `_notify_issued` gives.

    The previous shape called `notify()` once for the *whole* sweep with a
    context built from `invoices[0]` and, when more than one invoice was in
    play, an `outstanding` total summed across every family in the batch —
    every other family then saw a reminder naming a different child, a
    different invoice number, and a total that was not even their own balance.
    Reminders and overdue notices are exactly as per-family as an
    invoice-issued notice, so they need the same fix.
    """
    from core.notifications.services import Recipient

    if not invoices:
        return 0
    notified = 0
    _, users_by_student = _recipients_for(invoices)
    for invoice in invoices:
        recipients = [
            Recipient(user_id=user_id) for user_id in users_by_student.get(invoice.student_id, [])
        ]
        if not recipients:
            continue
        notify(
            event,
            tenant_id=tenant.pk,
            recipients=recipients,
            context={
                "school": {"name": tenant.name},
                "student": {"first_name": invoice.student.first_name},
                "invoice_no": invoice.invoice_no,
                "amount": str(invoice.balance_due),
                "due_date": invoice.due_date.isoformat(),
            },
            source_type="fee_invoice",
            source_id=invoice.pk,
        )
        notified += len(recipients)
    return notified
