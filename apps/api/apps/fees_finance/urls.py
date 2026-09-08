"""Routes for the fees-finance module — fees-finance.md §16.

Explicit `path()` entries come before `*router.urls` so a colon-action is not
swallowed by the router's detail pattern (`fee-structures/<pk>` matches
`<uuid>:activate` quite happily otherwise), matching every other module.

`:post-journal` is a *collection* colon-action rather than a detail one, because
the thing being created is a whole balanced posting rather than a change to one
entry. `LedgerEntryViewSet` has no create route for the same reason.
"""

from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.fees_finance.views import (
    DiscountViewSet,
    FeeHeadViewSet,
    FeeInvoiceViewSet,
    FeeScheduleViewSet,
    FeeStructureViewSet,
    FineViewSet,
    LedgerAccountViewSet,
    LedgerEntryViewSet,
    ScholarshipViewSet,
)

router = SimpleRouter(trailing_slash=False)
router.register("ledger-accounts", LedgerAccountViewSet, basename="ledger-accounts")
router.register("ledger-entries", LedgerEntryViewSet, basename="ledger-entries")
router.register("fee-heads", FeeHeadViewSet, basename="fee-heads")
router.register("fee-structures", FeeStructureViewSet, basename="fee-structures")
router.register("fee-schedules", FeeScheduleViewSet, basename="fee-schedules")
router.register("fee-invoices", FeeInvoiceViewSet, basename="fee-invoices")
router.register("discounts", DiscountViewSet, basename="discounts")
router.register("scholarships", ScholarshipViewSet, basename="scholarships")
router.register("fines", FineViewSet, basename="fines")

urlpatterns = [
    path(
        "ledger-entries:post-journal",
        LedgerEntryViewSet.as_view({"post": "post_journal"}),
        name="ledger-entries-post-journal",
    ),
    path(
        "fee-structures/<uuid:pk>:activate",
        FeeStructureViewSet.as_view({"post": "activate"}),
        name="fee-structures-activate",
    ),
    path(
        "fee-structures/<uuid:pk>:archive",
        FeeStructureViewSet.as_view({"post": "archive"}),
        name="fee-structures-archive",
    ),
    path(
        "fee-invoices:generate",
        FeeInvoiceViewSet.as_view({"post": "generate"}),
        name="fee-invoices-generate",
    ),
    path(
        "fee-invoices/<uuid:pk>:cancel",
        FeeInvoiceViewSet.as_view({"post": "cancel"}),
        name="fee-invoices-cancel",
    ),
    path(
        "discounts/<uuid:pk>:revoke",
        DiscountViewSet.as_view({"post": "revoke"}),
        name="discounts-revoke",
    ),
    path(
        "fines/<uuid:pk>:waive",
        FineViewSet.as_view({"post": "waive"}),
        name="fines-waive",
    ),
    *router.urls,
]
