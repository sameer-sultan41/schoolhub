"""Routes for the examinations module — examinations.md §16.

Explicit `path()` entries come before `*router.urls` so a colon-action is not
swallowed by the router's detail pattern (`grading-scales/<pk>` matches
`<uuid>:set-default` quite happily otherwise), matching every other module.

**Grade bands are hand-routed rather than registered.** §16 nests them under
their scale (`/grading-scales/{id}/grade-bands`), and `SimpleRouter` cannot
express a nested collection. Two `path()` entries — collection and detail — are
the whole of what the nesting costs, and they are clearer than a router plugin
for one resource. `scale_pk` is the kwarg `GradeBandViewSet.get_scale` reads.

**Two colon-actions sit under `/exams` but belong to other viewsets.**
`:publish-schedule` is `ExamScheduleViewSet.publish` and `:issue-admit-cards` is
`AdmitCardViewSet.issue`, because in both cases the *exam* is what the caller
addresses while the logic and the permission key belong to the resource being
produced. §16 declares both paths this way, and routing them from the owning
viewset keeps each action's `required_permission_map` beside the rest of its
resource's.
"""

from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.examinations.views import (
    AdmitCardViewSet,
    ExamScheduleViewSet,
    ExamSubjectViewSet,
    ExamViewSet,
    GradeBandViewSet,
    GradingScaleViewSet,
    MarksImportViewSet,
    MarksViewSet,
)

router = SimpleRouter(trailing_slash=False)
router.register("grading-scales", GradingScaleViewSet, basename="grading-scales")
router.register("exams", ExamViewSet, basename="exams")
router.register("exam-subjects", ExamSubjectViewSet, basename="exam-subjects")
router.register("exam-schedules", ExamScheduleViewSet, basename="exam-schedules")
router.register("admit-cards", AdmitCardViewSet, basename="admit-cards")
router.register("marks", MarksViewSet, basename="marks")

urlpatterns = [
    path(
        "marks:bulk-entry",
        MarksViewSet.as_view({"post": "bulk_entry"}),
        name="marks-bulk-entry",
    ),
    path(
        "marks-imports",
        MarksImportViewSet.as_view({"post": "create"}),
        name="marks-imports",
    ),
    path(
        "exam-subjects/<uuid:pk>:lock-marks",
        MarksViewSet.as_view({"post": "lock"}),
        name="exam-subjects-lock-marks",
    ),
    path(
        "exam-subjects/<uuid:pk>:unlock-marks",
        MarksViewSet.as_view({"post": "unlock"}),
        name="exam-subjects-unlock-marks",
    ),
    path(
        "exams/<uuid:pk>/marks-progress",
        MarksViewSet.as_view({"get": "progress"}),
        name="exams-marks-progress",
    ),
    path(
        "exams/<uuid:pk>:publish-schedule",
        ExamScheduleViewSet.as_view({"post": "publish"}),
        name="exams-publish-schedule",
    ),
    path(
        "exams/<uuid:pk>:issue-admit-cards",
        AdmitCardViewSet.as_view({"post": "issue"}),
        name="exams-issue-admit-cards",
    ),
    path(
        "admit-cards/<uuid:pk>:revoke",
        AdmitCardViewSet.as_view({"post": "revoke"}),
        name="admit-cards-revoke",
    ),
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
