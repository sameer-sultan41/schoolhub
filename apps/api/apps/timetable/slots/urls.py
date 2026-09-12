"""Routes for `timetable-slots`, `:validate`/`:publish`, and `/timetables/my`
(timetable.md §16).

Explicit `path()` entries come before `*router.urls` so a colon-action is not
swallowed by the router's detail pattern, matching every other module —
same convention as the root `apps.timetable.urls` this package's routes are
cut from.

`timetables/` is not a router prefix: there is no `timetables` table. A section's
timetable is the set of its slots, so `{section_id}` on that prefix is a
**section** id and the only operations are the two colon-actions plus the
personal view.

**`POST /timetables/{section_id}:generate-draft` is deliberately absent.** §16
lists it as AI-TTB-01 — Phase 3, routed through the AI gateway in `core/ai`,
which has not been built.
"""

from __future__ import annotations

from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.timetable.slots.viewset import MyTimetableViewSet, TimetableSlotViewSet, TimetableViewSet

router = SimpleRouter(trailing_slash=False)
router.register("timetable-slots", TimetableSlotViewSet, basename="timetable-slots")

urlpatterns = [
    # Before the two `<uuid:pk>` patterns below: "my" is not a section id, and a
    # non-UUID segment would otherwise fall through to a 404 from the resolver
    # rather than reaching the view.
    path("timetables/my", MyTimetableViewSet.as_view({"get": "my"}), name="timetables-my"),
    path(
        "timetables/<uuid:pk>:validate",
        TimetableViewSet.as_view({"post": "validate"}),
        name="timetables-validate",
    ),
    path(
        "timetables/<uuid:pk>:publish",
        TimetableViewSet.as_view({"post": "publish"}),
        name="timetables-publish",
    ),
    *router.urls,
]
