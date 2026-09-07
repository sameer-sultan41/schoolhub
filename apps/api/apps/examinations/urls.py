"""Routes for the examinations module — examinations.md §16.

Explicit `path()` entries come before `*router.urls` so a colon-action is not
swallowed by the router's detail pattern (`grading-scales/<pk>` matches
`<uuid>:set-default` quite happily otherwise), matching every other module.

**Grade bands are hand-routed rather than registered.** §16 nests them under
their scale (`/grading-scales/{id}/grade-bands`), and `SimpleRouter` cannot
express a nested collection. Two `path()` entries — collection and detail — are
the whole of what the nesting costs, and they are clearer than a router plugin
for one resource. `scale_pk` is the kwarg `GradeBandViewSet.get_scale` reads.
"""

from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.examinations.views import (
    ExamSubjectViewSet,
    ExamViewSet,
    GradeBandViewSet,
    GradingScaleViewSet,
)

router = SimpleRouter(trailing_slash=False)
router.register("grading-scales", GradingScaleViewSet, basename="grading-scales")
router.register("exams", ExamViewSet, basename="exams")
router.register("exam-subjects", ExamSubjectViewSet, basename="exam-subjects")

urlpatterns = [
    path(
        "grading-scales/<uuid:pk>:set-default",
        GradingScaleViewSet.as_view({"post": "set_default"}),
        name="grading-scales-set-default",
    ),
    path(
        "grading-scales/<uuid:scale_pk>/grade-bands",
        GradeBandViewSet.as_view({"get": "list", "post": "create"}),
        name="grade-bands",
    ),
    path(
        "grading-scales/<uuid:scale_pk>/grade-bands/<uuid:pk>",
        GradeBandViewSet.as_view(
            {"get": "retrieve", "patch": "partial_update", "delete": "destroy"}
        ),
        name="grade-bands-detail",
    ),
    *router.urls,
]
