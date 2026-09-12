"""Routes for `/teacher-substitutions` — timetable.md §16.

The two colon-action paths come before `*router.urls` so a colon-action is not
swallowed by the router's detail pattern (`teacher-substitutions/<pk>` matches
`<uuid>:approve` quite happily otherwise) — same convention as the root
`apps.timetable.urls` this package's routes are cut from.
"""

from __future__ import annotations

from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.timetable.substitutions.viewset import TeacherSubstitutionViewSet

router = SimpleRouter(trailing_slash=False)
router.register(
    "teacher-substitutions", TeacherSubstitutionViewSet, basename="teacher-substitutions"
)

urlpatterns = [
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
