"""`GalleryAlbumViewSet` — `/gallery-albums` (module doc §16). Albums have no archive action."""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework_simplejwt.authentication import JWTAuthentication

from apps.website_cms.gallery import services
from apps.website_cms.gallery.filters import GalleryAlbumFilterSet
from apps.website_cms.gallery.serializers import (
    GalleryAlbumSerializer,
    GalleryAlbumWriteSerializer,
)
from apps.website_cms.models import GalleryAlbum
from apps.website_cms.permissions import PAGE_VIEW_KEY
from apps.website_cms.views import FEATURE, STAFF_PERMISSIONS
from core.api.pagination import PageNumberPagination
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit


class GalleryAlbumViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`gallery-albums`: albums of images and video embeds with a publish workflow."""

    authentication_classes = [JWTAuthentication]
    permission_classes = STAFF_PERMISSIONS
    queryset = GalleryAlbum.objects
    filterset_class = GalleryAlbumFilterSet
    search_fields = ["title", "slug"]
    pagination_class = PageNumberPagination
    ordering_fields = ["title", "slug", "status", "published_at", "created_at", "updated_at"]
    # GalleryAlbum.Meta.ordering; the view repeats it because DRF reads the view's default.
    ordering = ["-created_at", "id"]
    scope_campus_field = None
    required_feature = FEATURE
    required_permission = PAGE_VIEW_KEY
    required_permission_map = {
        "create": "website.gallery-album.create",
        "update": "website.gallery-album.update",
        "partial_update": "website.gallery-album.update",
        "destroy": "website.gallery-album.delete",
        "publish": "website.gallery-album.publish",
        "unpublish": "website.gallery-album.publish",
    }
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_serializer_class(self):
        if self.action in ("create", "partial_update"):
            return GalleryAlbumWriteSerializer
        return GalleryAlbumSerializer

    @extend_schema(request=GalleryAlbumWriteSerializer, responses={201: GalleryAlbumSerializer})
    def create(self, request: Request, *args, **kwargs) -> Response:
        serializer = GalleryAlbumWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        album = services.create_gallery_album(
            request.tenant, serializer.validated_data, request.user.pk
        )
        data = GalleryAlbumSerializer(album).data
        record_audit(request, "create", album, after=data)
        return ActionResponse.ok(data, message="Album created.", status=201)

    @extend_schema(request=GalleryAlbumWriteSerializer, responses={200: GalleryAlbumSerializer})
    def partial_update(self, request: Request, *args, **kwargs) -> Response:
        album = self.get_object()
        serializer = GalleryAlbumWriteSerializer(album, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        before = GalleryAlbumSerializer(album).data
        album = services.update_gallery_album(album, serializer.validated_data, request.user)
        data = GalleryAlbumSerializer(album).data
        record_audit(request, "update", album, before=before, after=data)
        return ActionResponse.ok(data, message="Album updated.")

    @extend_schema(responses={204: None})
    def destroy(self, request: Request, *args, **kwargs) -> Response:
        album = self.get_object()
        before = GalleryAlbumSerializer(album).data
        services.delete_gallery_album(album, request.user)
        record_audit(request, "delete", album, before=before)
        return Response(status=204)

    def _transition(self, request: Request, action_name: str, message: str) -> Response:
        album = self.get_object()
        before = GalleryAlbumSerializer(album).data
        album = getattr(services, f"{action_name}_gallery_album")(album, request.user)
        data = GalleryAlbumSerializer(album).data
        record_audit(request, action_name, album, before=before, after=data)
        return ActionResponse.ok(data, message=message)

    @extend_schema(request=None, responses={200: GalleryAlbumSerializer})
    def publish(self, request: Request, pk: str) -> Response:
        return self._transition(request, "publish", "Album published.")

    @extend_schema(request=None, responses={200: GalleryAlbumSerializer})
    def unpublish(self, request: Request, pk: str) -> Response:
        return self._transition(request, "unpublish", "Album unpublished.")
