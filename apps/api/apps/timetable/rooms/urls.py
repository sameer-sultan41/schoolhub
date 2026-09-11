"""Routes for `/rooms`. No colon-actions — this resource has none."""

from __future__ import annotations

from rest_framework.routers import SimpleRouter

from apps.timetable.rooms.viewset import RoomViewSet

router = SimpleRouter(trailing_slash=False)
router.register("rooms", RoomViewSet, basename="rooms")

urlpatterns = [
    *router.urls,
]
