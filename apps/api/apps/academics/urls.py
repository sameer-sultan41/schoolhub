"""Routes for the academics module — academics.md §16.

Explicit `path()` entries come before `*router.urls` so a colon-action is not
swallowed by the router's detail pattern, matching every other module.

Every `{id}` under `student-promotions` is a **batch id**. Decisions hang off a
batch and are addressed by student, which is both §16's shape and what keeps one
path prefix from carrying two id spaces.
"""

from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.academics.views import (
    CurriculumViewSet,
    PromotionBatchViewSet,
    PromotionDecisionViewSet,
    TeacherAllocationViewSet,
)

router = SimpleRouter(trailing_slash=False)
router.register("class-subjects", CurriculumViewSet, basename="class-subjects")
router.register(
    "teacher-subject-allocations", TeacherAllocationViewSet, basename="teacher-subject-allocations"
)

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
        PromotionBatchViewSet.as_view({"get": "list", "post": "create_batch"}),
        name="student-promotions-list",
    ),
    # The nested decision route is declared before the batch detail route so
    # `/{batch}/decisions/{student}` is not matched as a batch id containing
    # slashes.
    path(
        "student-promotions/<uuid:batch_pk>/decisions/<uuid:student_pk>",
        PromotionDecisionViewSet.as_view({"patch": "partial_update"}),
        name="student-promotions-decision",
    ),
    path(
        "student-promotions/<uuid:pk>:submit",
        PromotionBatchViewSet.as_view({"post": "submit"}),
        name="student-promotions-submit",
    ),
    path(
        "student-promotions/<uuid:pk>:approve",
        PromotionBatchViewSet.as_view({"post": "approve"}),
        name="student-promotions-approve",
    ),
    path(
        "student-promotions/<uuid:pk>:reject",
        PromotionBatchViewSet.as_view({"post": "reject"}),
        name="student-promotions-reject",
    ),
    path(
        "student-promotions/<uuid:pk>:execute",
        PromotionBatchViewSet.as_view({"post": "execute"}),
        name="student-promotions-execute",
    ),
    path(
        "student-promotions/<uuid:pk>:revert",
        PromotionBatchViewSet.as_view({"post": "revert"}),
        name="student-promotions-revert",
    ),
    path(
        "student-promotions/<uuid:pk>",
        PromotionBatchViewSet.as_view({"get": "retrieve"}),
        name="student-promotions-detail",
    ),
    *router.urls,
]
