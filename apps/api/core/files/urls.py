from django.urls import path
from rest_framework.routers import SimpleRouter

from core.files.views import FileViewSet

router = SimpleRouter(trailing_slash=False)
router.register("files", FileViewSet, basename="files")

urlpatterns = [
    path(
        "files/<uuid:pk>:confirm",
        FileViewSet.as_view({"post": "confirm"}),
        name="files-confirm",
    ),
    path(
        "files/<uuid:pk>:download",
        FileViewSet.as_view({"post": "download"}),
        name="files-download",
    ),
    *router.urls,
]
