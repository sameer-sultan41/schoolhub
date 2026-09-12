"""Routes for `/class-subjects` — academics.md §16.

The colon-action path comes before `*router.urls` so it is not swallowed by the
router's detail pattern, matching every other module.
"""

from __future__ import annotations

from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.academics.curriculum.viewset import CurriculumViewSet

router = SimpleRouter(trailing_slash=False)
router.register("class-subjects", CurriculumViewSet, basename="class-subjects")

urlpatterns = [
    path(
        "class-subjects:clone",
        CurriculumViewSet.as_view({"post": "clone"}),
        name="class-subjects-clone",
    ),
    *router.urls,
]
