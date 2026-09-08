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

from django.db import models, transaction
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.fees_finance import services
from apps.fees_finance.filters import (
    DiscountFilterSet,
    FeeHeadFilterSet,
    FeeInvoiceFilterSet,
    FeeScheduleFilterSet,
    FeeStructureFilterSet,
    FineFilterSet,
    LedgerAccountFilterSet,
    LedgerEntryFilterSet,
    ScholarshipFilterSet,
)
from apps.fees_finance.ledger import LedgerLine
from apps.fees_finance.models import (
    Discount,
    FeeHead,
    FeeInvoice,
    FeeSchedule,
    FeeStructure,
    Fine,
    InvoiceStatus,
    LedgerAccount,
    LedgerEntry,
    Scholarship,
    ScholarshipStatus,
)
from apps.fees_finance.serializers import (
    CancelInvoiceSerializer,
    DiscountSerializer,
    FeeHeadSerializer,
    FeeInvoiceSerializer,
    FeeScheduleSerializer,
    FeeStructureSerializer,
    FineSerializer,
    GenerateInvoicesSerializer,
    LedgerAccountSerializer,
    LedgerEntrySerializer,
    ManualJournalSerializer,
    ScholarshipSerializer,
    WaiveSerializer,
)
from apps.fees_finance.tasks import generate_invoices_task
from apps.school_organization.models import Term
from core.api.permissions import RequiresModuleFeature
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit
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
