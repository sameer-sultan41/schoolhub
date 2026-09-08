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
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.fees_finance import services
from apps.fees_finance.filters import (
    FeeHeadFilterSet,
    FeeScheduleFilterSet,
    FeeStructureFilterSet,
    LedgerAccountFilterSet,
    LedgerEntryFilterSet,
)
from apps.fees_finance.ledger import LedgerLine
from apps.fees_finance.models import (
    FeeHead,
    FeeSchedule,
    FeeStructure,
    LedgerAccount,
    LedgerEntry,
)
from apps.fees_finance.serializers import (
    FeeHeadSerializer,
    FeeScheduleSerializer,
    FeeStructureSerializer,
    LedgerAccountSerializer,
    LedgerEntrySerializer,
    ManualJournalSerializer,
)
from core.api.permissions import RequiresModuleFeature
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit
from core.idempotency.services import replay_or_execute
from core.money import ZERO
from core.rbac.permissions import DenyRestrictedPrincipals, HasPermissionKey, scope_queryset

FEATURE = "module.fees_finance"

# No portal-readable viewset ships in this PR. Guardians and students reach
# invoices and receipts in PR B, where the record scope narrows them; a chart of
# accounts and a fee structure have no per-family reading.
STAFF_PERMISSIONS = [
    IsAuthenticated,
    RequiresModuleFeature,
    HasPermissionKey,
    DenyRestrictedPrincipals,
]


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
