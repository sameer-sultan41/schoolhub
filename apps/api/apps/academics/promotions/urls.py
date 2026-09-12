"""Routes for `/student-promotions` — academics.md §16.

No router here — every route is an explicit `path()`, ordered so a
colon-action or the nested decision route is never swallowed by the batch
detail pattern (`student-promotions/<uuid:pk>`), matching every other
module's convention for hand-wired routes.

Every `{id}` under `student-promotions` is a **batch id**. Decisions hang off a
batch and are addressed by student, which is both §16's shape and what keeps one
path prefix from carrying two id spaces.
"""

from django.urls import path

from apps.academics.promotions.viewset import PromotionBatchViewSet, PromotionDecisionViewSet

urlpatterns = [
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
]
