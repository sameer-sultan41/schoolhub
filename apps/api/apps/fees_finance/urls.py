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
    FeeHeadViewSet,
    FeeScheduleViewSet,
    FeeStructureViewSet,
    LedgerAccountViewSet,
    LedgerEntryViewSet,
)

router = SimpleRouter(trailing_slash=False)
router.register("ledger-accounts", LedgerAccountViewSet, basename="ledger-accounts")
router.register("ledger-entries", LedgerEntryViewSet, basename="ledger-entries")
router.register("fee-heads", FeeHeadViewSet, basename="fee-heads")
router.register("fee-structures", FeeStructureViewSet, basename="fee-structures")
router.register("fee-schedules", FeeScheduleViewSet, basename="fee-schedules")

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
    *router.urls,
]
