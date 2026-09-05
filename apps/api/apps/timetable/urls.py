"""Routes for the timetable module — timetable.md §16.

Explicit `path()` entries come before `*router.urls` so a colon-action is not
swallowed by the router's detail pattern (`teacher-substitutions/<pk>` matches
`<uuid>:approve` quite happily otherwise), matching every other module.

`timetables/` is not a router prefix: there is no `timetables` table. A section's
timetable is the set of its slots, so `{section_id}` on that prefix is a
**section** id and the only operations are the two colon-actions plus the
personal view.

**`POST /timetables/{section_id}:generate-draft` is deliberately absent.** §16
lists it as AI-TTB-01 — Phase 3, routed through the AI gateway in `core/ai`,
which has not been built. See views.py's module docstring.
"""

from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.timetable.views import (
    MyTimetableViewSet,
    PeriodViewSet,
    RoomViewSet,
    TeacherSubstitutionViewSet,
    TimetableSlotViewSet,
    TimetableViewSet,
)

router = SimpleRouter(trailing_slash=False)
router.register("rooms", RoomViewSet, basename="rooms")
router.register("periods", PeriodViewSet, basename="periods")
router.register("timetable-slots", TimetableSlotViewSet, basename="timetable-slots")
router.register(
    "teacher-substitutions", TeacherSubstitutionViewSet, basename="teacher-substitutions"
)

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
    path(
        "teacher-substitutions/<uuid:pk>:approve",
        TeacherSubstitutionViewSet.as_view({"post": "approve"}),
        name="teacher-substitutions-approve",
    ),
    path(
        "teacher-substitutions/<uuid:pk>:reject",
        TeacherSubstitutionViewSet.as_view({"post": "reject"}),
        name="teacher-substitutions-reject",
    ),
    *router.urls,
]
