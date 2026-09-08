"""HTTP layer for the fees-finance module.

Thin by design: every rule that needs more than the request body lives in
`services` or `ledger`, so the API, a management command and (later) the
settlement importer all apply the same checks.

**`LedgerEntryViewSet` is read-only, and that is structural rather than a
permission decision.** It mixes in list and retrieve only, so no create, update
or destroy route exists to defend. Two reasons it has to be that way:

* A client that could POST one line could post an *unbalanced* transaction, and
  balance is a property of the set of lines sharing a `transaction_id`. Postings
  therefore go through `ledger.post_transaction`, which validates the set.
* The table is append-only with UPDATE and DELETE revoked from the application
  role, so a PATCH route would be a 500 waiting to be found rather than a 403.

It also overrides `get_queryset` to skip `.alive()`. `TenantScopedViewSetMixin`
calls it, and `ledger_entries` has no `deleted_at` column — soft delete is an
UPDATE, which is exactly what an append-only table revokes — so inheriting it
unchanged would be a `FieldError` on every request. The same reasoning rules out
`perform_create`, which stamps `updated_by`.

A manual journal is the one write path, and it is a colon-action rather than a
POST to the collection precisely so the request body is a whole balanced
posting instead of one line.

**`scope_campus_field = None` on the ledger and fee-head viewsets.** A chart of
accounts and a fee head are school-wide — a campus does not have its own idea of
what tuition is called. Left at the mixin's `campus_id` default, every
campus-scoped caller would get a `FieldError` on a column that does not exist,
the bug `LeaveTypeViewSet` documents. `fee_structures` has a real `campus_id`
and keeps the default.
"""

from __future__ import annotations

import base64
import datetime
import uuid

from django.db import models, transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.fees_finance import documents, services, uploads
from apps.fees_finance.filters import (
    BudgetFilterSet,
    DiscountFilterSet,
    ExpenseCategoryFilterSet,
    ExpenseFilterSet,
    FeeHeadFilterSet,
    FeeInvoiceFilterSet,
    FeeScheduleFilterSet,
    FeeStructureFilterSet,
    FeeVoucherFilterSet,
    FineFilterSet,
    LedgerAccountFilterSet,
    LedgerEntryFilterSet,
    PaymentFilterSet,
    ReceiptFilterSet,
    RefundFilterSet,
    ScholarshipFilterSet,
    VoucherImportFilterSet,
)
from apps.fees_finance.ledger import LedgerLine
from apps.fees_finance.models import (
    Budget,
    Discount,
    Expense,
    ExpenseCategory,
    FeeHead,
    FeeInvoice,
    FeeSchedule,
    FeeStructure,
    FeeVoucher,
    Fine,
    InvoiceStatus,
    LedgerAccount,
    LedgerEntry,
    Payment,
    Receipt,
    Refund,
    Scholarship,
    ScholarshipStatus,
    VoucherCollectionImport,
    VoucherProvider,
)
from apps.fees_finance.serializers import (
    BudgetSerializer,
    CancelInvoiceSerializer,
    DiscountSerializer,
    ExpenseCategorySerializer,
    ExpenseSerializer,
    FeeHeadSerializer,
    FeeInvoiceSerializer,
    FeeScheduleSerializer,
    FeeStructureSerializer,
    FeeVoucherSerializer,
    FinanceReportQuerySerializer,
    FineSerializer,
    GenerateInvoicesSerializer,
    IssueVoucherSerializer,
    LedgerAccountSerializer,
    LedgerEntrySerializer,
    ManualJournalSerializer,
    PaymentSerializer,
    ProcessRefundSerializer,
    ReceiptSerializer,
    RecordPaymentSerializer,
    RefundDecisionSerializer,
    RefundSerializer,
    RequestRefundSerializer,
    ScholarshipSerializer,
    VoucherCollectionImportSerializer,
    WaiveSerializer,
)
from apps.fees_finance.tasks import (
    export_finance_report_task,
    generate_invoices_task,
    import_settlement_file_task,
    notify_payment_received,
    notify_refund_status,
    render_receipt_task,
)
from apps.school_organization.models import Term
from core.api.exceptions import DomainRuleViolation
from core.api.permissions import RequiresModuleFeature
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit
from core.files.services import create_ready_file
from core.idempotency.services import replay_or_execute
from core.jobs.services import create_job
from core.money import ZERO
from core.rbac.permissions import (
    DenyRestrictedPrincipals,
    HasPermissionKey,
    is_restricted_principal,
    scope_queryset,
)

FEATURE = "module.fees_finance"

# A chart of accounts and a fee structure have no per-family reading, so the
# PR A viewsets are staff-only outright.
STAFF_PERMISSIONS = [
    IsAuthenticated,
    RequiresModuleFeature,
    HasPermissionKey,
    DenyRestrictedPrincipals,
]

# Students and guardians reach the four PR B viewsets that use this, and only
# for reads. The record scope, not the permission class, is what narrows them —
# see `FeeInvoiceViewSet.get_permissions` for why it cannot be a class attribute.
PORTAL_READABLE_PERMISSIONS = [IsAuthenticated, RequiresModuleFeature, HasPermissionKey]


class LedgerAccountViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`/ledger-accounts` — §5.8's per-tenant chart of accounts."""

    permission_classes = STAFF_PERMISSIONS
    queryset = LedgerAccount.objects
    serializer_class = LedgerAccountSerializer
    filterset_class = LedgerAccountFilterSet
    search_fields = ["code", "name"]
    ordering_fields = ["code", "name", "created_at"]
    scope_campus_field = None
    required_feature = FEATURE
    required_permission = "fees.ledger.view"
    required_permission_map = {
        "create": "fees.ledger.create",
        "update": "fees.ledger.create",
        "partial_update": "fees.ledger.create",
        "destroy": "fees.ledger.create",
    }
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def perform_destroy(self, instance: LedgerAccount) -> None:
        """Refuse to delete a system account, and audit the rest.

        The CHECK constraint `ledger_accounts_system_not_deleted` would refuse
        this too, but as a 409 naming a constraint. The service check names the
        account and says what to do instead.
        """
        services.assert_account_may_be_deleted(account=instance)
        record_audit(self.request, "delete", instance)
        super().perform_destroy(instance)


class LedgerEntryViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """`/ledger-entries` — the general ledger, read-only. See the module docstring."""

    permission_classes = STAFF_PERMISSIONS
    queryset = LedgerEntry.objects
    serializer_class = LedgerEntrySerializer
    filterset_class = LedgerEntryFilterSet
    search_fields = ["memo"]
    ordering_fields = ["entry_date", "created_at"]
    scope_campus_field = None
    required_feature = FEATURE
    required_permission = "fees.ledger.view"
    required_permission_map = {"post_journal": "fees.ledger.create"}
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        """Deliberately not `super().get_queryset()`, but still `scope_queryset`.

        The mixin's version ends in `.alive()`, which filters `deleted_at` — a
        column an append-only table does not have and cannot have, because soft
        delete is an UPDATE. That is the only reason this cannot just call
        `super().get_queryset()`.

        Skipping `scope_queryset` entirely, rather than reproducing the mixin's
        call to it, was the actual bug: a hand-rolled `.filter(tenant_id=...)`
        stops at tenant scoping and never asks about record scope at all. For
        `RecordScope.ALL` and `RecordScope.CAMPUS` that happens to look the
        same as passing `campus_field=None` through `scope_queryset` — a ledger
        has no campus dimension, so CAMPUS scope is already satisfied by tenant
        scoping, per that function's own docstring. But an `own`- or
        `assigned`-scoped grant is not the same: `scope_queryset` fails that
        closed to `.none()` because `LedgerEntry` defines neither hook, while
        the hand-rolled filter let it see every posting in the tenant. `fees.
        ledger.view`'s default roles are `all`-scoped, but the whole point of
        calling `scope_queryset` is not to depend on that staying true.
        """
        return (
            scope_queryset(
                LedgerEntry.objects.filter(tenant_id=self.request.tenant.pk),
                self.request.user,
                campus_field=None,
            )
            .select_related("ledger_account")
            .order_by("-entry_date", "created_at")
        )

    @extend_schema(
        request=ManualJournalSerializer, responses={201: LedgerEntrySerializer(many=True)}
    )
    def post_journal(self, request: Request) -> Response:
        """`POST /ledger-entries:post-journal` — §8's hand-written journal entry.

        A colon-action rather than a POST to the collection, because the unit of
        a posting is the balanced *set* of lines. One line at a time could never
        be validated.

        `Idempotency-Key` through `replay_or_execute`, §11's contract for every
        money mutation and the one this endpoint was missing: a journal entry
        is a ledger posting like any other, and a retried request after a
        timeout must not post the same correction twice onto a table that
        cannot be corrected by anything but a second, offsetting posting.
        """
        serializer = ManualJournalSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data
        key = request.headers.get("Idempotency-Key")

        def execute() -> Response:
            with transaction.atomic():
                transaction_id = services.post_manual_journal(
                    entry_date=payload["entry_date"],
                    lines=[
                        LedgerLine(
                            ledger_account_id=line["ledger_account"],
                            debit=line["debit"],
                            credit=line["credit"],
                            memo=line.get("memo"),
                        )
                        for line in payload["lines"]
                    ],
                    memo=payload["memo"],
                    actor_id=request.user.pk,
                )
                posted = list(
                    LedgerEntry.objects.filter(transaction_id=transaction_id).select_related(
                        "ledger_account"
                    )
                )
                # `posted[0]` is an arbitrary choice of "the" audited resource —
                # a multi-line posting has no single natural one — so the
                # payload carries what actually identifies the posting: the
                # transaction id every line shares, plus how many lines and how
                # much moved, so the audit row is self-describing regardless of
                # which line record_audit happened to be handed.
                record_audit(
                    request,
                    "create",
                    posted[0],
                    after={
                        "transaction_id": str(transaction_id),
                        "line_count": len(posted),
                        "total_debit": str(sum((line.debit for line in posted), ZERO)),
                    },
                )

            return ActionResponse.ok(
                LedgerEntrySerializer(posted, many=True).data,
                message="Journal entry posted.",
                status=201,
            )

        return replay_or_execute(
            tenant_id=request.tenant.pk,
            key=key,
            endpoint="ledger-entries:post-journal",
            execute=execute,
        )


class FeeHeadViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`/fee-heads` — §5.1's chargeable categories."""

    permission_classes = STAFF_PERMISSIONS
    queryset = FeeHead.objects
    serializer_class = FeeHeadSerializer
    filterset_class = FeeHeadFilterSet
    search_fields = ["code", "name"]
    ordering_fields = ["code", "name", "created_at"]
    scope_campus_field = None
    required_feature = FEATURE
    required_permission = "fees.fee-structure.view"
    required_permission_map = {
        "create": "fees.fee-structure.create",
        "update": "fees.fee-structure.update",
        "partial_update": "fees.fee-structure.update",
        "destroy": "fees.fee-structure.delete",
    }
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return super().get_queryset().select_related("ledger_account")

    def perform_destroy(self, instance: FeeHead) -> None:
        services.assert_fee_head_is_unused(fee_head=instance)
        record_audit(self.request, "delete", instance)
        super().perform_destroy(instance)


class FeeStructureViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`/fee-structures` — §5.1's named fee set, with its §6 lifecycle."""

    permission_classes = STAFF_PERMISSIONS
    queryset = FeeStructure.objects
    serializer_class = FeeStructureSerializer
    filterset_class = FeeStructureFilterSet
    search_fields = ["name"]
    ordering_fields = ["name", "created_at"]
    required_feature = FEATURE
    required_permission = "fees.fee-structure.view"
    required_permission_map = {
        "create": "fees.fee-structure.create",
        "update": "fees.fee-structure.update",
        "partial_update": "fees.fee-structure.update",
        "destroy": "fees.fee-structure.delete",
        "activate": "fees.fee-structure.update",
        "archive": "fees.fee-structure.update",
    }
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        # `schedules` is nested on the serializer, so without this every
        # structure in a list costs a query for its lines.
        #
        # `Prefetch(..., queryset=FeeSchedule.objects.alive())`, not a bare
        # `"schedules"` string: the reverse relation walks FeeSchedule's plain
        # manager, which does not filter `deleted_at` on its own — a bare
        # prefetch would nest a soft-deleted line back into every structure's
        # response.
        return (
            super()
            .get_queryset()
            .select_related("academic_session", "school_class", "campus")
            .prefetch_related(models.Prefetch("schedules", queryset=FeeSchedule.objects.alive()))
        )

    @extend_schema(request=None, responses={200: FeeStructureSerializer})
    def activate(self, request: Request, pk: str | None = None) -> Response:
        """`POST /fee-structures/{id}:activate`.

        The two checks it runs — at least one schedule, no other active
        structure at the same scope — are both about a set of rows, so neither
        can be a constraint. See `services.activate_fee_structure`.
        """
        structure = self.get_object()
        activated = services.activate_fee_structure(structure=structure, actor_id=request.user.pk)
        record_audit(request, "update", activated, after={"status": activated.status})
        return ActionResponse.ok(
            self.get_serializer(activated).data, message="Fee structure activated."
        )

    @extend_schema(request=None, responses={200: FeeStructureSerializer})
    def archive(self, request: Request, pk: str | None = None) -> Response:
        """`POST /fee-structures/{id}:archive`.

        Invoices already priced from this structure are untouched — archiving
        stops it being used again, it does not rewrite history.
        """
        structure = self.get_object()
        archived = services.archive_fee_structure(structure=structure, actor_id=request.user.pk)
        record_audit(request, "update", archived, after={"status": archived.status})
        return ActionResponse.ok(
            self.get_serializer(archived).data, message="Fee structure archived."
        )


class FeeScheduleViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`/fee-schedules` — §5.1's structure lines and installment schedule."""

    permission_classes = STAFF_PERMISSIONS
    queryset = FeeSchedule.objects
    serializer_class = FeeScheduleSerializer
    filterset_class = FeeScheduleFilterSet
    ordering_fields = ["amount", "created_at"]
    # A schedule's campus, if any, is its structure's. There is no `campus_id`
    # on this table, so the mixin's default would raise.
    scope_campus_field = None
    required_feature = FEATURE
    required_permission = "fees.fee-structure.view"
    required_permission_map = {
        "create": "fees.fee-structure.create",
        "update": "fees.fee-structure.update",
        "partial_update": "fees.fee-structure.update",
        "destroy": "fees.fee-structure.delete",
    }
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return super().get_queryset().select_related("fee_head", "fee_structure", "term")

    def perform_destroy(self, instance: FeeSchedule) -> None:
        services.assert_structure_is_editable(structure=instance.fee_structure)
        record_audit(self.request, "delete", instance)
        super().perform_destroy(instance)


class FeeInvoiceViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`/fee-invoices` — §5.2's invoices, readable by the family they concern.

    **Portal-readable, and it uses `get_permissions` rather than a class
    attribute.** §3 gives a guardian and student a view of their own invoices,
    so reads drop `DenyRestrictedPrincipals` and let the record scope narrow
    them through `FeeInvoice.filter_owned_by_user`. Every write keeps the guard,
    and it has to be resolved per action because **DRF resolves
    `permission_classes` per view, not per action** — the privilege-escalation
    finding PR #42 produced, where a viewset-wide portal exemption covered a
    bulk write too. Generating a term's invoices for a whole school is not a
    scoped read of one child's row.

    A restricted principal is additionally held to *issued* invoices. A draft is
    a working document the accountant has not handed over, and showing a parent
    a charge that may still change is worse than showing them nothing.
    """

    queryset = FeeInvoice.objects
    serializer_class = FeeInvoiceSerializer
    filterset_class = FeeInvoiceFilterSet
    search_fields = ["invoice_no", "student__first_name", "student__last_name"]
    ordering_fields = ["issue_date", "due_date", "balance_due", "created_at"]
    scope_campus_field = "student__campus_id"
    required_feature = FEATURE
    required_permission = "fees.invoice.view"
    required_permission_map = {
        "create": "fees.invoice.create",
        "generate": "fees.invoice.create",
        "update": "fees.invoice.update",
        "partial_update": "fees.invoice.update",
        "destroy": "fees.invoice.update",
        "cancel": "fees.invoice.update",
    }
    http_method_names = ["get", "post", "patch", "head", "options"]

    PORTAL_READABLE_ACTIONS = frozenset({"list", "retrieve"})

    def get_permissions(self):
        """Reads may be portal calls; writes never are.

        Inverted deliberately — the staff set is the default and the portal
        exemption is the narrow case. A new action added later inherits the
        guard rather than the exemption, which is the safe direction for the
        mistake to go.
        """
        if self.action in self.PORTAL_READABLE_ACTIONS:
            return [permission() for permission in PORTAL_READABLE_PERMISSIONS]
        return [permission() for permission in STAFF_PERMISSIONS]

    def get_queryset(self):
        queryset = (
            super()
            .get_queryset()
            .select_related("student", "fee_structure", "academic_session")
            .prefetch_related("lines__fee_head")
        )
        if is_restricted_principal(self.request.user):
            return queryset.exclude(status=InvoiceStatus.DRAFT)
        return queryset

    @extend_schema(request=GenerateInvoicesSerializer, responses={202: None})
    def generate(self, request: Request) -> Response:
        """`POST /fee-invoices:generate` — 202 + job.

        Idempotency-Key honoured through `replay_or_execute`, which is the
        platform's contract for a money mutation (§11's closing line). The
        run itself is also idempotent at the database — the duplicate guard
        means a re-run skips what is already billed — so the two layers cover
        different failures: the key stops a double *submit*, the index stops a
        double *bill*.
        """
        serializer = GenerateInvoicesSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data

        structure = get_object_or_404(
            FeeStructure.objects.select_related("academic_session"),
            pk=payload["fee_structure"],
        )
        services.assert_structure_is_billable(structure=structure)
        if payload.get("term"):
            # Resolved through the tenant-scoped manager, so a foreign term is a
            # 404 rather than a term silently belonging to another school.
            get_object_or_404(Term.objects, pk=payload["term"])

        def execute() -> Response:
            job = create_job(
                tenant_id=request.tenant.pk,
                job_type="fees.generate-invoices",
                payload={
                    "fee_structure_id": str(structure.pk),
                    "period_start": (
                        payload["period_start"].isoformat() if payload.get("period_start") else None
                    ),
                    "term_id": str(payload["term"]) if payload.get("term") else None,
                    "requested_by": str(request.user.pk),
                },
                actor_id=request.user.pk,
                idempotency_key=request.headers.get("Idempotency-Key"),
            )
            record_audit(request, "create", job, after={"job_type": job.job_type})
            transaction.on_commit(
                lambda: generate_invoices_task.delay(
                    tenant_id=str(request.tenant.pk),
                    job_id=str(job.pk),
                    actor_id=str(request.user.pk),
                )
            )
            return ActionResponse.accepted(str(job.pk), message="Invoice generation queued.")

        return replay_or_execute(
            tenant_id=request.tenant.pk,
            key=request.headers.get("Idempotency-Key"),
            endpoint="fee-invoices:generate",
            execute=execute,
        )

    @extend_schema(request=CancelInvoiceSerializer, responses={200: FeeInvoiceSerializer})
    def cancel(self, request: Request, pk: str | None = None) -> Response:
        """`POST /fee-invoices/{id}:cancel` — void it and release its period."""
        serializer = CancelInvoiceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        invoice = self.get_object()

        canceled = services.cancel_invoice(
            invoice=invoice,
            reason=serializer.validated_data["reason"],
            actor_id=request.user.pk,
        )
        record_audit(request, "update", canceled, after={"status": canceled.status})
        return ActionResponse.ok(self.get_serializer(canceled).data, message="Invoice canceled.")


class DiscountViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`/discounts` — §5.3's student-level reductions.

    Portal-readable for the same reason invoices are: a parent shown a reduced
    bill has to be able to see the reduction that explains it.
    """

    queryset = Discount.objects
    serializer_class = DiscountSerializer
    filterset_class = DiscountFilterSet
    search_fields = ["name", "student__first_name", "student__last_name"]
    ordering_fields = ["created_at", "value"]
    scope_campus_field = "student__campus_id"
    required_feature = FEATURE
    required_permission = "fees.discount.view"
    required_permission_map = {
        "create": "fees.discount.create",
        "update": "fees.discount.create",
        "partial_update": "fees.discount.create",
        "destroy": "fees.discount.waive",
        "revoke": "fees.discount.waive",
    }
    http_method_names = ["get", "post", "patch", "head", "options"]

    PORTAL_READABLE_ACTIONS = frozenset({"list", "retrieve"})

    def get_permissions(self):
        if self.action in self.PORTAL_READABLE_ACTIONS:
            return [permission() for permission in PORTAL_READABLE_PERMISSIONS]
        return [permission() for permission in STAFF_PERMISSIONS]

    def get_queryset(self):
        return super().get_queryset().select_related("student", "fee_head")

    def perform_create(self, serializer):
        """Stamp the granter from the request, never from the body.

        `discounts_active_is_attributable` refuses an active grant with no
        approver, and taking the value from the request is what makes that
        attribution mean something — a client-supplied `approved_by` would let a
        reduction name someone who never saw it.
        """
        instance = serializer.save(
            tenant=self.request.tenant,
            created_by=self.request.user.pk,
            updated_by=self.request.user.pk,
            approved_by=self.request.user.pk,
        )
        record_audit(self.request, "create", instance)

    @extend_schema(request=WaiveSerializer, responses={200: DiscountSerializer})
    def revoke(self, request: Request, pk: str | None = None) -> Response:
        """`POST /discounts/{id}:revoke`.

        Forward-looking: invoices already priced with this grant keep their
        figures. Re-pricing an issued invoice would change what a parent was
        told they owe, which belongs in an adjustment line rather than a silent
        rewrite.
        """
        serializer = WaiveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        discount = self.get_object()

        revoked = services.revoke_discount(
            discount=discount,
            reason=serializer.validated_data["reason"],
            actor_id=request.user.pk,
        )
        # `revoke_discount` deliberately leaves `Discount.reason` — the record
        # of why it was *granted* — untouched, so the caller's stated reason
        # for revoking is carried here instead, where it is durable without
        # overloading a column the schema gives one meaning.
        record_audit(
            request,
            "update",
            revoked,
            after={
                "status": revoked.status,
                "revocation_reason": serializer.validated_data["reason"],
            },
        )
        return ActionResponse.ok(self.get_serializer(revoked).data, message="Discount revoked.")


class ScholarshipViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`/scholarships` — §5.3's awards and their lifecycle."""

    queryset = Scholarship.objects
    serializer_class = ScholarshipSerializer
    filterset_class = ScholarshipFilterSet
    search_fields = ["name", "sponsor", "student__first_name", "student__last_name"]
    ordering_fields = ["created_at", "value"]
    scope_campus_field = "student__campus_id"
    required_feature = FEATURE
    required_permission = "fees.discount.view"
    required_permission_map = {
        "create": "fees.scholarship.create",
        "update": "fees.scholarship.create",
        "partial_update": "fees.scholarship.create",
    }
    http_method_names = ["get", "post", "patch", "head", "options"]

    PORTAL_READABLE_ACTIONS = frozenset({"list", "retrieve"})

    def get_permissions(self):
        if self.action in self.PORTAL_READABLE_ACTIONS:
            return [permission() for permission in PORTAL_READABLE_PERMISSIONS]
        return [permission() for permission in STAFF_PERMISSIONS]

    def get_queryset(self):
        return super().get_queryset().select_related("student")

    def perform_create(self, serializer):
        """An award past `applied` must name its approver — see the CHECK.

        `applied` is the one status with no approver, because that is what
        "applied" means: the school has not decided yet. Anything else is a
        decision, and a decision nobody is recorded as having made is the
        finding an auditor writes up.
        """
        status = serializer.validated_data.get("status", ScholarshipStatus.APPROVED)
        approver = None if status == ScholarshipStatus.APPLIED else self.request.user.pk
        instance = serializer.save(
            tenant=self.request.tenant,
            created_by=self.request.user.pk,
            updated_by=self.request.user.pk,
            approved_by=approver,
        )
        record_audit(self.request, "create", instance)

    def perform_update(self, serializer):
        """Deciding an applied award stamps the approver at that moment."""
        status = serializer.validated_data.get("status", serializer.instance.status)
        approver = serializer.instance.approved_by
        if status != ScholarshipStatus.APPLIED and approver is None:
            approver = self.request.user.pk
        instance = serializer.save(updated_by=self.request.user.pk, approved_by=approver)
        record_audit(self.request, "update", instance)


class FineViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`/fines` — §5.3's penalties, folded onto the next invoice."""

    queryset = Fine.objects
    serializer_class = FineSerializer
    filterset_class = FineFilterSet
    search_fields = ["reason", "student__first_name", "student__last_name"]
    ordering_fields = ["created_at", "amount"]
    scope_campus_field = "student__campus_id"
    required_feature = FEATURE
    required_permission = "fees.fine.view"
    required_permission_map = {
        "create": "fees.fine.create",
        "update": "fees.fine.create",
        "partial_update": "fees.fine.create",
        "waive": "fees.fine.waive",
    }
    http_method_names = ["get", "post", "patch", "head", "options"]

    PORTAL_READABLE_ACTIONS = frozenset({"list", "retrieve"})

    def get_permissions(self):
        if self.action in self.PORTAL_READABLE_ACTIONS:
            return [permission() for permission in PORTAL_READABLE_PERMISSIONS]
        return [permission() for permission in STAFF_PERMISSIONS]

    def get_queryset(self):
        return super().get_queryset().select_related("student", "fee_head")

    @extend_schema(request=WaiveSerializer, responses={200: FineSerializer})
    def waive(self, request: Request, pk: str | None = None) -> Response:
        """`POST /fines/{id}:waive` — §4's `fees.fine.waive`."""
        serializer = WaiveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        fine = self.get_object()

        waived = services.waive_fine(
            fine=fine,
            reason=serializer.validated_data["reason"],
            actor_id=request.user.pk,
        )
        record_audit(request, "update", waived, after={"status": waived.status})
        return ActionResponse.ok(self.get_serializer(waived).data, message="Fine waived.")


class PaymentViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """`/payments` — money in. Read-only as a collection; `:record` takes it.

    No `create` route, deliberately. A payment is never just a row: it carries a
    balance check, a gapless receipt number, a ledger posting and a
    recomputation of the invoice's five money columns, all in one transaction.
    A plain `POST /payments` that wrote the row and left a signal to do the rest
    is precisely how a confirmed payment ends up with no ledger entry.

    Portal-readable, so a family can see what they have paid.
    """

    queryset = Payment.objects
    serializer_class = PaymentSerializer
    filterset_class = PaymentFilterSet
    search_fields = ["reference_no", "student__first_name", "student__last_name"]
    ordering_fields = ["paid_at", "amount", "created_at"]
    scope_campus_field = "student__campus_id"
    required_feature = FEATURE
    required_permission = "fees.payment.view"
    required_permission_map = {"record": "fees.payment.collect"}
    http_method_names = ["get", "post", "head", "options"]

    PORTAL_READABLE_ACTIONS = frozenset({"list", "retrieve"})

    def get_permissions(self):
        if self.action in self.PORTAL_READABLE_ACTIONS:
            return [permission() for permission in PORTAL_READABLE_PERMISSIONS]
        return [permission() for permission in STAFF_PERMISSIONS]

    def get_queryset(self):
        return super().get_queryset().select_related("student", "fee_invoice", "receipt")

    @extend_schema(request=RecordPaymentSerializer, responses={201: PaymentSerializer})
    def record(self, request: Request) -> Response:
        """⚿ `POST /payments:record` — take money against an invoice.

        `Idempotency-Key` through `replay_or_execute`, which is the platform's
        contract for a money mutation (§11's closing line). The header stops a
        double *submit*; `payments_idempotency_key_unique` stops a concurrent
        one, because `replay_or_execute` documents itself as check-then-store
        and therefore not concurrency-safe. Two layers, two different failures.
        """
        serializer = RecordPaymentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data

        invoice: FeeInvoice = get_object_or_404(FeeInvoice.objects, pk=payload["fee_invoice"])
        key = request.headers.get("Idempotency-Key")

        def execute() -> Response:
            with transaction.atomic():
                payment = services.record_payment(
                    invoice=invoice,
                    amount=payload["amount"],
                    method=payload["method"],
                    reference_no=payload.get("reference_no"),
                    gateway_provider=None,
                    actor_id=request.user.pk,
                    tenant_id=request.tenant.pk,
                    idempotency_key=key,
                )
                record_audit(request, "create", payment, after={"amount": str(payment.amount)})
                receipt_id = str(payment.receipt.pk)
                transaction.on_commit(
                    lambda: render_receipt_task.delay(
                        tenant_id=str(request.tenant.pk),
                        receipt_id=receipt_id,
                        actor_id=str(request.user.pk),
                    )
                )
                transaction.on_commit(
                    lambda: notify_payment_received.delay(
                        tenant_id=str(request.tenant.pk), payment_id=str(payment.pk)
                    )
                )
            payment.refresh_from_db()
            return ActionResponse.ok(
                PaymentSerializer(payment).data, message="Payment recorded.", status=201
            )

        return replay_or_execute(
            tenant_id=request.tenant.pk,
            key=key,
            endpoint="payments:record",
            execute=execute,
        )


class ReceiptViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """`/receipts` — read-only. Receipts are issued by `payments:record`.

    §16 gives this a `?format=pdf|thermal` download. Both layouts come from the
    same template data (§10's requirement) so a printed receipt and a thermal
    one cannot disagree about what was paid.
    """

    queryset = Receipt.objects
    serializer_class = ReceiptSerializer
    filterset_class = ReceiptFilterSet
    search_fields = ["receipt_no"]
    ordering_fields = ["issued_at", "amount"]
    scope_campus_field = "payment__student__campus_id"
    required_feature = FEATURE
    required_permission = "fees.payment.view"
    http_method_names = ["get", "head", "options"]

    PORTAL_READABLE_ACTIONS = frozenset({"list", "retrieve", "download"})

    def get_permissions(self):
        if self.action in self.PORTAL_READABLE_ACTIONS:
            return [permission() for permission in PORTAL_READABLE_PERMISSIONS]
        return [permission() for permission in STAFF_PERMISSIONS]

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .select_related("payment__student", "payment__fee_invoice", "pdf_file")
        )

    @extend_schema(responses={200: None})
    def download(self, request: Request, pk: str | None = None) -> Response:
        """`GET /receipts/{id}/download?format=pdf|thermal`.

        Rendered on demand rather than served from the stored PDF, because the
        thermal layout is a different document and pre-rendering both for every
        receipt would double the storage for a format most are never printed in.
        The A4 one is still stored — that is what `render_receipt_task` does —
        so an audit has a fixed artefact.
        """
        receipt = self.get_object()
        layout = (
            documents.THERMAL if request.query_params.get("format") == "thermal" else documents.A4
        )
        data = documents.render_receipt(
            receipt=receipt,
            payment=receipt.payment,
            invoice=receipt.payment.fee_invoice,
            student=receipt.payment.student,
            school_name=request.tenant.name,
            page_size=layout,
        )
        response = HttpResponse(data, content_type="application/pdf")
        response["Content-Disposition"] = f'inline; filename="receipt-{receipt.receipt_no}.pdf"'
        return response


class RefundViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """`/refunds` — §7.3's request → decide → process workflow.

    Every transition is a colon-action and none is a PATCH, because each carries
    a rule a serializer cannot express: the remainder still refundable, the
    segregation of duties, and the ledger reversal.
    """

    queryset = Refund.objects
    serializer_class = RefundSerializer
    filterset_class = RefundFilterSet
    ordering_fields = ["created_at", "amount"]
    scope_campus_field = "student__campus_id"
    required_feature = FEATURE
    required_permission = "fees.payment.view"
    required_permission_map = {
        "request_refund": "fees.payment.refund",
        "approve": "fees.refund.approve",
        "reject": "fees.refund.approve",
        "process": "fees.refund.approve",
    }
    http_method_names = ["get", "post", "head", "options"]

    PORTAL_READABLE_ACTIONS = frozenset({"list", "retrieve"})

    def get_permissions(self):
        if self.action in self.PORTAL_READABLE_ACTIONS:
            return [permission() for permission in PORTAL_READABLE_PERMISSIONS]
        return [permission() for permission in STAFF_PERMISSIONS]

    def get_queryset(self):
        return super().get_queryset().select_related("student", "payment")

    @extend_schema(request=RequestRefundSerializer, responses={201: RefundSerializer})
    def request_refund(self, request: Request) -> Response:
        """⚿ `POST /refunds` — §7.3 step one."""
        serializer = RequestRefundSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data
        payment: Payment = get_object_or_404(Payment.objects, pk=payload["payment"])
        key = request.headers.get("Idempotency-Key")

        def execute() -> Response:
            refund = services.request_refund(
                payment=payment,
                amount=payload["amount"],
                reason=payload["reason"],
                actor_id=request.user.pk,
                tenant_id=request.tenant.pk,
                idempotency_key=key,
            )
            record_audit(request, "create", refund, after={"amount": str(refund.amount)})
            return ActionResponse.ok(
                RefundSerializer(refund).data, message="Refund requested.", status=201
            )

        return replay_or_execute(
            tenant_id=request.tenant.pk, key=key, endpoint="refunds:create", execute=execute
        )

    @extend_schema(request=RefundDecisionSerializer, responses={200: RefundSerializer})
    def approve(self, request: Request, pk: str | None = None) -> Response:
        """`POST /refunds/{id}:approve`. The requester cannot be the approver."""
        return self._decide(request, approve=True, message="Refund approved.")

    @extend_schema(request=RefundDecisionSerializer, responses={200: RefundSerializer})
    def reject(self, request: Request, pk: str | None = None) -> Response:
        return self._decide(request, approve=False, message="Refund rejected.")

    def _decide(self, request: Request, *, approve: bool, message: str) -> Response:
        serializer = RefundDecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        refund = self.get_object()

        decided = services.decide_refund(
            refund=refund,
            approve=approve,
            note=serializer.validated_data.get("note") or None,
            actor_id=request.user.pk,
        )
        record_audit(request, "approve", decided, after={"status": decided.status})
        transaction.on_commit(
            lambda: notify_refund_status.delay(
                tenant_id=str(request.tenant.pk), refund_id=str(decided.pk)
            )
        )
        return ActionResponse.ok(self.get_serializer(decided).data, message=message)

    @extend_schema(request=ProcessRefundSerializer, responses={200: RefundSerializer})
    def process(self, request: Request, pk: str | None = None) -> Response:
        """⚿ `POST /refunds/{id}:process` — pay it out and reverse the ledger."""
        serializer = ProcessRefundSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        refund = self.get_object()
        key = request.headers.get("Idempotency-Key")

        def execute() -> Response:
            processed = services.process_refund(
                refund=refund,
                method=serializer.validated_data["method"],
                reference_no=serializer.validated_data.get("reference_no"),
                actor_id=request.user.pk,
            )
            record_audit(request, "update", processed, after={"status": processed.status})
            transaction.on_commit(
                lambda: notify_refund_status.delay(
                    tenant_id=str(request.tenant.pk), refund_id=str(processed.pk)
                )
            )
            return ActionResponse.ok(RefundSerializer(processed).data, message="Refund processed.")

        return replay_or_execute(
            tenant_id=request.tenant.pk, key=key, endpoint="refunds:process", execute=execute
        )


class FeeVoucherViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """`/vouchers` — §7.2's printable bank/wallet slips.

    Issued from the invoice (`/fee-invoices/{id}/vouchers`), never posted here:
    every field but the provider is derived at issuance, and a client that could
    set the amount could print a voucher for a figure the invoice does not owe.
    """

    queryset = FeeVoucher.objects
    serializer_class = FeeVoucherSerializer
    filterset_class = FeeVoucherFilterSet
    search_fields = ["consumer_number"]
    ordering_fields = ["due_date", "created_at"]
    scope_campus_field = "student__campus_id"
    required_feature = FEATURE
    required_permission = "fees.payment.view"
    required_permission_map = {
        "issue": "fees.payment.collect",
        "void": "fees.payment.collect",
    }
    http_method_names = ["get", "post", "head", "options"]

    PORTAL_READABLE_ACTIONS = frozenset({"list", "retrieve", "download"})

    def get_permissions(self):
        if self.action in self.PORTAL_READABLE_ACTIONS:
            return [permission() for permission in PORTAL_READABLE_PERMISSIONS]
        return [permission() for permission in STAFF_PERMISSIONS]

    def get_queryset(self):
        return super().get_queryset().select_related("student", "fee_invoice")

    @extend_schema(request=IssueVoucherSerializer, responses={201: FeeVoucherSerializer})
    def issue(self, request: Request, pk: str | None = None) -> Response:
        """`POST /fee-invoices/{id}/vouchers` — print a slip for this invoice."""
        serializer = IssueVoucherSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        invoice: FeeInvoice = get_object_or_404(FeeInvoice.objects, pk=pk)

        voucher = services.issue_voucher(
            invoice=invoice,
            provider=serializer.validated_data["provider"],
            actor_id=request.user.pk,
            tenant_id=request.tenant.pk,
            validity_days=serializer.validated_data.get("validity_days"),
        )
        record_audit(request, "issue", voucher, after={"amount": str(voucher.amount)})
        return ActionResponse.ok(
            FeeVoucherSerializer(voucher).data, message="Voucher issued.", status=201
        )

    @extend_schema(request=WaiveSerializer, responses={200: FeeVoucherSerializer})
    def void(self, request: Request, pk: str | None = None) -> Response:
        """`POST /vouchers/{id}:void` — §7.2's correction, which is never an edit."""
        serializer = WaiveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        voucher = self.get_object()

        voided = services.void_voucher(
            voucher=voucher,
            reason=serializer.validated_data["reason"],
            actor_id=request.user.pk,
        )
        record_audit(request, "update", voided, after={"status": voided.status})
        return ActionResponse.ok(self.get_serializer(voided).data, message="Voucher voided.")

    @extend_schema(responses={200: None})
    def download(self, request: Request, pk: str | None = None) -> Response:
        """`GET /vouchers/{id}/download?format=pdf|thermal`."""
        voucher = self.get_object()
        layout = (
            documents.THERMAL if request.query_params.get("format") == "thermal" else documents.A4
        )
        data = documents.render_voucher(
            voucher=voucher,
            invoice=voucher.fee_invoice,
            student=voucher.student,
            school_name=request.tenant.name,
            page_size=layout,
        )
        response = HttpResponse(data, content_type="application/pdf")
        response["Content-Disposition"] = (
            f'inline; filename="voucher-{voucher.consumer_number}.pdf"'
        )
        return response


class VoucherCollectionImportViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """`/voucher-collection-imports` — §7.2's daily settlement reconciliation.

    Staff-only outright: a settlement file is a bank's record of what it
    collected, and nothing about it belongs in a portal.
    """

    permission_classes = STAFF_PERMISSIONS
    queryset = VoucherCollectionImport.objects
    serializer_class = VoucherCollectionImportSerializer
    filterset_class = VoucherImportFilterSet
    ordering_fields = ["created_at"]
    scope_campus_field = None
    required_feature = FEATURE
    required_permission = "fees.payment.view"
    required_permission_map = {"create": "fees.payment.collect"}
    parser_classes = [MultiPartParser]
    http_method_names = ["get", "post", "head", "options"]

    @extend_schema(request=None, responses={202: None})
    def create(self, request: Request, *args, **kwargs) -> Response:
        """⚿ `POST /voucher-collection-imports` — 202 + job.

        The file is stored *and* its bytes go into the job payload. Storing it
        is not redundant: a settlement file is a financial record a school has
        to retain, and `file_id` is where an auditor goes for the original. The
        payload is how the worker reads it, matching the platform's established
        import shape.
        """
        upload = request.FILES.get("file")
        provider = request.data.get("provider")
        if upload is None:
            raise DomainRuleViolation({"file": "A settlement file is required."})
        if provider not in VoucherProvider.values:
            known = ", ".join(VoucherProvider.values)
            raise DomainRuleViolation({"provider": f"Unknown provider. Expected one of: {known}."})

        data = upload.read()
        key = request.headers.get("Idempotency-Key")

        def execute() -> Response:
            with transaction.atomic():
                stored = create_ready_file(
                    tenant_id=request.tenant.pk,
                    purpose=uploads.SETTLEMENT_FILE.key,
                    original_name=upload.name,
                    mime_type=upload.content_type or "text/csv",
                    data=data,
                    actor_id=request.user.pk,
                )
                voucher_import = VoucherCollectionImport.objects.create(
                    tenant_id=request.tenant.pk,
                    provider=provider,
                    file=stored,
                    imported_by=request.user.pk,
                    created_by=request.user.pk,
                    updated_by=request.user.pk,
                )
                job = create_job(
                    tenant_id=request.tenant.pk,
                    job_type="fees.import-settlement-file",
                    payload={
                        "voucher_import_id": str(voucher_import.pk),
                        "content_base64": base64.b64encode(data).decode(),
                    },
                    actor_id=request.user.pk,
                    idempotency_key=key,
                )
                record_audit(request, "import", voucher_import, after={"provider": provider})
                transaction.on_commit(
                    lambda: import_settlement_file_task.delay(
                        tenant_id=str(request.tenant.pk),
                        job_id=str(job.pk),
                        actor_id=str(request.user.pk),
                    )
                )
            return ActionResponse.accepted(str(job.pk), message="Settlement import queued.")

        return replay_or_execute(
            tenant_id=request.tenant.pk,
            key=key,
            endpoint="voucher-collection-imports:create",
            execute=execute,
        )


class ExpenseCategoryViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`/expense-categories` — §5.9's spend taxonomy."""

    permission_classes = STAFF_PERMISSIONS
    queryset = ExpenseCategory.objects
    serializer_class = ExpenseCategorySerializer
    filterset_class = ExpenseCategoryFilterSet
    search_fields = ["code", "name"]
    ordering_fields = ["code", "name"]
    # A category is school-wide; a campus does not have its own idea of what
    # "utilities" means. Left at the mixin's default this would raise for every
    # campus-scoped caller.
    scope_campus_field = None
    required_feature = FEATURE
    required_permission = "fees.expense.view"
    required_permission_map = {
        "create": "fees.expense.create",
        "update": "fees.expense.create",
        "partial_update": "fees.expense.create",
        "destroy": "fees.expense.create",
    }
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return super().get_queryset().select_related("ledger_account")

    def perform_destroy(self, instance: ExpenseCategory) -> None:
        """Refuse to delete a category anything has been filed against.

        Deleting frees `code` for reuse — `expense_categories_code_unique` is
        conditioned on `deleted_at IS NULL` — and a soft delete is an UPDATE, so
        the FK's `on_delete=PROTECT` never sees it. Without this check the
        delete would succeed while every expense and budget still on the row
        quietly loses its category from every report that filters `.alive()`.
        """
        services.assert_expense_category_may_be_deleted(category=instance)
        record_audit(self.request, "delete", instance)
        super().perform_destroy(instance)


class ExpenseViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`/expenses` — §5.9's spend, under §7's approval gate.

    Staff-only outright: nothing about what a school spends belongs in a
    parent portal.
    """

    permission_classes = STAFF_PERMISSIONS
    queryset = Expense.objects
    serializer_class = ExpenseSerializer
    filterset_class = ExpenseFilterSet
    search_fields = ["expense_no", "vendor_name", "description"]
    ordering_fields = ["expense_date", "amount", "created_at"]
    required_feature = FEATURE
    required_permission = "fees.expense.view"
    required_permission_map = {
        "create": "fees.expense.create",
        "update": "fees.expense.update",
        "partial_update": "fees.expense.update",
        "submit": "fees.expense.create",
        "approve": "fees.expense.approve",
        "reject": "fees.expense.approve",
        "mark_paid": "fees.expense.update",
        "reverse": "fees.expense.approve",
    }
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        return super().get_queryset().select_related("expense_category", "campus", "receipt_file")

    def perform_create(self, serializer):
        """Allocate the expense number inside the creating transaction.

        `allocate_number` asserts it is inside one, which is what makes the
        sequence gapless: a create that fails afterwards does not burn a number.
        """
        with transaction.atomic():
            instance = serializer.save(
                tenant=self.request.tenant,
                expense_no=services.allocate_expense_no(
                    tenant_id=self.request.tenant.pk,
                    on_date=serializer.validated_data["expense_date"],
                ),
                created_by=self.request.user.pk,
                updated_by=self.request.user.pk,
            )
            record_audit(self.request, "create", instance)

    @extend_schema(request=None, responses={200: ExpenseSerializer})
    def submit(self, request: Request, pk: str | None = None) -> Response:
        """`POST /expenses/{id}:submit` — into the approval queue."""
        submitted = services.submit_expense(expense=self.get_object(), actor_id=request.user.pk)
        record_audit(request, "update", submitted, after={"status": submitted.status})
        return ActionResponse.ok(self.get_serializer(submitted).data, message="Expense submitted.")

    @extend_schema(request=None, responses={200: ExpenseSerializer})
    def approve(self, request: Request, pk: str | None = None) -> Response:
        """`POST /expenses/{id}:approve` — and post it to the ledger.

        The submitter cannot approve their own, checked in `services` for the
        reason refunds' equivalent is: the rule is the module's and has to hold
        through any door.
        """
        approved = services.decide_expense(
            expense=self.get_object(), approve=True, actor_id=request.user.pk
        )
        record_audit(request, "approve", approved, after={"status": approved.status})
        return ActionResponse.ok(self.get_serializer(approved).data, message="Expense approved.")

    @extend_schema(request=None, responses={200: ExpenseSerializer})
    def reject(self, request: Request, pk: str | None = None) -> Response:
        rejected = services.decide_expense(
            expense=self.get_object(), approve=False, actor_id=request.user.pk
        )
        record_audit(request, "approve", rejected, after={"status": rejected.status})
        return ActionResponse.ok(self.get_serializer(rejected).data, message="Expense rejected.")

    @extend_schema(request=None, responses={200: ExpenseSerializer})
    def mark_paid(self, request: Request, pk: str | None = None) -> Response:
        """`POST /expenses/{id}:mark-paid` — it has left the bank.

        Posts nothing: approval already moved the money in the books, and
        posting again would double-count it.
        """
        paid = services.mark_expense_paid(expense=self.get_object(), actor_id=request.user.pk)
        record_audit(request, "update", paid, after={"status": paid.status})
        return ActionResponse.ok(self.get_serializer(paid).data, message="Expense marked paid.")

    @extend_schema(request=WaiveSerializer, responses={200: ExpenseSerializer})
    def reverse(self, request: Request, pk: str | None = None) -> Response:
        """`POST /expenses/{id}:reverse` — undo an approved or paid expense.

        A reversal, never an edit: the original posting stays exactly as made
        and a new transaction moves the same amounts back — the ledger's
        only correction path, mirroring `process_refund`'s.
        """
        serializer = WaiveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        reversed_expense = services.reverse_expense(
            expense=self.get_object(),
            reason=serializer.validated_data["reason"],
            actor_id=request.user.pk,
        )
        record_audit(
            request,
            "update",
            reversed_expense,
            after={
                "status": reversed_expense.status,
                "reason": serializer.validated_data["reason"],
            },
        )
        return ActionResponse.ok(
            self.get_serializer(reversed_expense).data, message="Expense reversed."
        )


class BudgetViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`/budgets` — §5.10's planned figures, and the variance report's baseline."""

    permission_classes = STAFF_PERMISSIONS
    queryset = Budget.objects
    serializer_class = BudgetSerializer
    filterset_class = BudgetFilterSet
    search_fields = ["name"]
    ordering_fields = ["period_start", "amount"]
    required_feature = FEATURE
    required_permission = "fees.expense.view"
    required_permission_map = {
        "create": "fees.budget.create",
        "update": "fees.budget.create",
        "partial_update": "fees.budget.create",
        "approve": "fees.budget.approve",
    }
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        return super().get_queryset().select_related("ledger_account", "expense_category", "campus")

    @extend_schema(request=None, responses={200: BudgetSerializer})
    def approve(self, request: Request, pk: str | None = None) -> Response:
        """`POST /budgets/{id}:approve`. §4 puts this with the owner alone.

        Only an approved budget appears in the variance report — a draft is a
        proposal, and reporting against one would show a school measuring itself
        against a figure nobody signed off.
        """
        approved = services.approve_budget(budget=self.get_object(), actor_id=request.user.pk)
        record_audit(request, "approve", approved, after={"status": approved.status})
        return ActionResponse.ok(self.get_serializer(approved).data, message="Budget approved.")


class FinanceReportView(APIView):
    """`GET/POST /reports/finance-summary` — §13, `kind`-parameterised.

    `GET` serves inline; `POST` asks for an export and returns 202 + job. One
    view because the row set and the record scope are identical either way, and
    two views would be two places for the scope to be applied differently.

    **The cap is requested as `limit + 1`.** That is how the endpoint decides
    "inline or job?" without building a term-scale result twice, which is the
    fix attendance's review produced.
    """

    permission_classes = STAFF_PERMISSIONS
    required_feature = FEATURE
    required_permission = "fees.report.view"
    required_permission_map = {"post": "fees.report.export"}

    @extend_schema(parameters=[FinanceReportQuerySerializer], responses={200: None})
    def get(self, request: Request) -> Response:
        serializer = FinanceReportQuerySerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data

        rows = services.build_report_rows(
            kind=payload["kind"],
            user=request.user,
            date_from=payload["date_from"],
            date_to=payload["date_to"],
            student_id=payload.get("student"),
            group_by=payload.get("group_by", "day"),
            limit=services.SYNCHRONOUS_REPORT_ROW_LIMIT + 1,
        )

        if len(rows) > services.SYNCHRONOUS_REPORT_ROW_LIMIT:
            raise DomainRuleViolation(
                "This report is too large to return inline. POST the same "
                "parameters to receive it as an export job.",
                meta={"row_limit": services.SYNCHRONOUS_REPORT_ROW_LIMIT},
            )

        # A bare `Response` with a pre-shaped envelope, not `ActionResponse.ok`:
        # `EnvelopeJSONRenderer` passes a payload that already has both keys
        # through untouched, and wrapping it again would nest `meta` inside
        # `data`.
        return Response(
            {
                "data": rows,
                "meta": {
                    "kind": payload["kind"],
                    "row_count": len(rows),
                    "date_from": payload["date_from"].isoformat(),
                    "date_to": payload["date_to"].isoformat(),
                },
            }
        )

    @extend_schema(request=FinanceReportQuerySerializer, responses={202: None})
    def post(self, request: Request) -> Response:
        serializer = FinanceReportQuerySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data

        job = create_job(
            tenant_id=request.tenant.pk,
            job_type="fees.export-report",
            payload={
                "kind": payload["kind"],
                "date_from": payload["date_from"].isoformat(),
                "date_to": payload["date_to"].isoformat(),
                "student_id": str(payload["student"]) if payload.get("student") else None,
                "group_by": payload.get("group_by", "day"),
                "format": payload.get("format", "csv"),
                # Read back by the task to recompute the record scope, which is
                # what stops an export widening what its requester could see.
                "requested_by": str(request.user.pk),
            },
            actor_id=request.user.pk,
            idempotency_key=request.headers.get("Idempotency-Key"),
        )
        transaction.on_commit(
            lambda: export_finance_report_task.delay(
                tenant_id=str(request.tenant.pk),
                job_id=str(job.pk),
                actor_id=str(request.user.pk),
            )
        )
        return ActionResponse.accepted(str(job.pk), message="Report export queued.")


class StudentLedgerView(APIView):
    """`GET /students/{id}/ledger` — §13.3's printable statement.

    Its own view rather than a `kind` on the report endpoint, because §16
    declares this path and because a family reads it: this is the one report a
    portal principal reaches, narrowed by record scope through the same
    `build_report_rows` the staff endpoint uses.
    """

    permission_classes = PORTAL_READABLE_PERMISSIONS
    required_feature = FEATURE
    required_permission = "fees.invoice.view"

    @extend_schema(responses={200: None})
    def get(self, request: Request, pk: str | None = None) -> Response:
        rows = services.build_report_rows(
            kind="student-ledger",
            user=request.user,
            # The whole history: a statement is not period-bounded, and a
            # parent asking what they owe means in total.
            date_from=datetime.date.min,
            date_to=datetime.date.max,
            student_id=uuid.UUID(str(pk)),
        )
        closing = rows[-1]["balance"] if rows else ZERO
        return Response(
            {"data": rows, "meta": {"row_count": len(rows), "closing_balance": str(closing)}}
        )
