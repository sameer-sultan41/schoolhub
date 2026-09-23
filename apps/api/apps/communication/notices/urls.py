"""Routes for `/notices`."""

from __future__ import annotations

from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.communication.notices.viewset import NoticeViewSet

router = SimpleRouter(trailing_slash=False)
router.register("notices", NoticeViewSet, basename="notices")

urlpatterns = [
    path(
        "notices/<uuid:pk>/download",
        NoticeViewSet.as_view({"get": "download"}),
        name="notices-download",
    ),
    path(
        "notices/<uuid:pk>:submit",
        NoticeViewSet.as_view({"post": "submit"}),
        name="notices-submit",
    ),
    path(
        "notices/<uuid:pk>:publish",
        NoticeViewSet.as_view({"post": "publish"}),
        name="notices-publish",
    ),
    path(
        "notices/<uuid:pk>:return-to-draft",
        NoticeViewSet.as_view({"post": "return_to_draft"}),
        name="notices-return-to-draft",
    ),
    path(
        "notices/<uuid:pk>:acknowledge",
        NoticeViewSet.as_view({"post": "acknowledge"}),
        name="notices-acknowledge",
    ),
    *router.urls,
]
