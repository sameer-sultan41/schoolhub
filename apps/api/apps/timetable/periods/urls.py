"""Routes for `/periods` — timetable.md §16.

No colon-actions on this resource — a plain router registration.
"""

from __future__ import annotations

from rest_framework.routers import SimpleRouter

from apps.timetable.periods.viewset import PeriodViewSet

router = SimpleRouter(trailing_slash=False)
router.register("periods", PeriodViewSet, basename="periods")

urlpatterns = [
    *router.urls,
]
