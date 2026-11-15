"""`GalleryItemViewSet` — `/gallery-albums/{id}/gallery-items` (module doc §16).

Items have no key of their own in §4: reads use the content read key, writes
`website.gallery-album.update` ("manage galleries and items").
"""

from __future__ import annotations

from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework_simplejwt.authentication import JWTAuthentication

from apps.website_cms.gallery import item_services as services
from apps.website_cms.gallery.serializers import (
    GalleryItemSerializer,
    GalleryItemWriteSerializer,
    ReorderItemsSerializer,
)
from apps.website_cms.models import GalleryAlbum, GalleryItem
from apps.website_cms.permissions import PAGE_VIEW_KEY
from apps.website_cms.views import FEATURE, STAFF_PERMISSIONS
from core.api.pagination import PageNumberPagination
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit

_UPDATE_KEY = "website.gallery-album.update"


class GalleryItemViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`gallery-items`: the ordered media of one album."""

    authentication_classes = [JWTAuthentication]
    permission_classes = STAFF_PERMISSIONS
    queryset = GalleryItem.objects
    lookup_url_kwarg = "item_id"
    pagination_class = PageNumberPagination
    ordering_fields = ["position", "created_at"]
    ordering = ["position", "id"]
    scope_campus_field = None
    required_feature = FEATURE
    required_permission = PAGE_VIEW_KEY
    required_permission_map = {
        "create": _UPDATE_KEY,
        "update": _UPDATE_KEY,
        "partial_update": _UPDATE_KEY,
        "destroy": _UPDATE_KEY,
        "reorder": _UPDATE_KEY,
    }
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_serializer_class(self):
        if self.action in ("create", "partial_update"):
            return GalleryItemWriteSerializer
        return GalleryItemSerializer

    def _album(self) -> GalleryAlbum:
        """The URL's album, found under the tenant scope; another tenant's is a 404."""
        return get_object_or_404(GalleryAlbum.objects.alive(), pk=self.kwargs["pk"])

    def get_queryset(self):
        return super().get_queryset().filter(gallery_album=self._album())

    @extend_schema(request=GalleryItemWriteSerializer, responses={201: GalleryItemSerializer})
    def create(self, request: Request, *args, **kwargs) -> Response:
        album = self._album()
        serializer = GalleryItemWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        item = services.create_gallery_item(
            request.tenant, album, serializer.validated_data, request.user.pk
        )
        data = GalleryItemSerializer(item).data
        record_audit(request, "create", item, after=data)
        return ActionResponse.ok(data, message="Item added.", status=201)

    @extend_schema(request=GalleryItemWriteSerializer, responses={200: GalleryItemSerializer})
    def partial_update(self, request: Request, *args, **kwargs) -> Response:
        item = self.get_object()
        serializer = GalleryItemWriteSerializer(item, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        before = GalleryItemSerializer(item).data
        item = services.update_gallery_item(
            self._album(), item, serializer.validated_data, request.user.pk
        )
        data = GalleryItemSerializer(item).data
        record_audit(request, "update", item, before=before, after=data)
        return ActionResponse.ok(data, message="Item updated.")

    @extend_schema(responses={204: None})
    def destroy(self, request: Request, *args, **kwargs) -> Response:
        item = self.get_object()
        before = GalleryItemSerializer(item).data
        services.delete_gallery_item(self._album(), item, request.user.pk)
        record_audit(request, "delete", item, before=before)
        return Response(status=204)

    @extend_schema(
        request=ReorderItemsSerializer, responses={200: GalleryItemSerializer(many=True)}
    )
    def reorder(self, request: Request, pk: str) -> Response:
        album = self._album()
        serializer = ReorderItemsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        items = services.reorder_gallery_items(
            album, serializer.validated_data["ids"], request.user.pk
        )
        data = GalleryItemSerializer(items, many=True).data
        record_audit(request, "update", album, after={"item_order": [str(i.id) for i in items]})
        return ActionResponse.ok(data, message="Items reordered.")
