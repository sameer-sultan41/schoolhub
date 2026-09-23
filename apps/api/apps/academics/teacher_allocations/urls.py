"""Routes for `/teacher-subject-allocations` — academics.md §16.

The colon-action path comes before `*router.urls` so it is not swallowed by the
router's detail pattern — same convention as the root `apps.academics.urls`
this package's routes are cut from.
"""

from __future__ import annotations

from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.academics.teacher_allocations.viewset import TeacherAllocationViewSet

router = SimpleRouter(trailing_slash=False)
router.register(
    "teacher-subject-allocations", TeacherAllocationViewSet, basename="teacher-subject-allocations"
)

urlpatterns = [
    # Before the router's `teacher-subject-allocations/<pk>` detail route, or
    # "load-summary" would be parsed as a primary key.
    path(
        "teacher-subject-allocations/load-summary",
        TeacherAllocationViewSet.as_view({"get": "load_summary"}),
        name="teacher-subject-allocations-load-summary",
    ),
    *router.urls,
]
