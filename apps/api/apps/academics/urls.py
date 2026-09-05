"""Routes for the academics module — academics.md §16.

Explicit `path()` entries come before `*router.urls` so a colon-action is not
swallowed by the router's detail pattern, matching every other module.
"""

from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.academics.views import (
    CurriculumViewSet,
    PromotionViewSet,
    TeacherAllocationViewSet,
)

router = SimpleRouter(trailing_slash=False)
router.register("class-subjects", CurriculumViewSet, basename="class-subjects")
router.register(
    "teacher-subject-allocations", TeacherAllocationViewSet, basename="teacher-subject-allocations"
)
router.register("student-promotions", PromotionViewSet, basename="student-promotions")

urlpatterns = [
    path(
        "class-subjects:clone",
        CurriculumViewSet.as_view({"post": "clone"}),
        name="class-subjects-clone",
    ),
    # Before the router's `teacher-subject-allocations/<pk>` detail route, or
    # "load-summary" would be parsed as a primary key.
    path(
        "teacher-subject-allocations/load-summary",
        TeacherAllocationViewSet.as_view({"get": "load_summary"}),
        name="teacher-subject-allocations-load-summary",
    ),
    path(
        "student-promotions",
        PromotionViewSet.as_view({"get": "list", "post": "create_batch"}),
        name="student-promotions-list",
    ),
    path(
        "student-promotions/<uuid:pk>:submit",
        PromotionViewSet.as_view({"post": "submit"}),
        name="student-promotions-submit",
    ),
    path(
        "student-promotions/<uuid:pk>:approve",
        PromotionViewSet.as_view({"post": "approve"}),
        name="student-promotions-approve",
    ),
    path(
        "student-promotions/<uuid:pk>:reject",
        PromotionViewSet.as_view({"post": "reject"}),
        name="student-promotions-reject",
    ),
    path(
        "student-promotions/<uuid:pk>:execute",
        PromotionViewSet.as_view({"post": "execute"}),
        name="student-promotions-execute",
    ),
    path(
        "student-promotions/<uuid:pk>:revert",
        PromotionViewSet.as_view({"post": "revert"}),
        name="student-promotions-revert",
    ),
    *router.urls,
]
