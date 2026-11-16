"""Routes for `/gallery-albums` and its nested `gallery-items` — module doc §16.

The colon-actions and the `gallery-items:reorder` route are declared before the bare detail
routes so none is swallowed by them.
"""

from django.urls import path

from apps.website_cms.gallery.item_viewset import GalleryItemViewSet
from apps.website_cms.gallery.viewset import GalleryAlbumViewSet

urlpatterns = [
    path(
        "gallery-albums",
        GalleryAlbumViewSet.as_view({"get": "list", "post": "create"}),
        name="gallery-albums-list",
    ),
    *(
        path(
            f"gallery-albums/<uuid:pk>:{action}",
            GalleryAlbumViewSet.as_view({"post": action}),
            name=f"gallery-albums-{action}",
        )
        for action in ("publish", "unpublish")
    ),
    path(
        "gallery-albums/<uuid:pk>/gallery-items:reorder",
        # A bulk action over one album: neither paginated nor filterable.
        GalleryItemViewSet.as_view({"patch": "reorder"}, pagination_class=None, filter_backends=[]),
        name="gallery-items-reorder",
    ),
    path(
        "gallery-albums/<uuid:pk>/gallery-items",
        GalleryItemViewSet.as_view({"get": "list", "post": "create"}),
        name="gallery-items-list",
    ),
    path(
        "gallery-albums/<uuid:pk>/gallery-items/<uuid:item_id>",
        GalleryItemViewSet.as_view({"patch": "partial_update", "delete": "destroy"}),
        name="gallery-items-detail",
    ),
    path(
        "gallery-albums/<uuid:pk>",
        GalleryAlbumViewSet.as_view(
            {"get": "retrieve", "patch": "partial_update", "delete": "destroy"}
        ),
        name="gallery-albums-detail",
    ),
]
