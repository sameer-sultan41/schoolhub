"""Public content feeds for the renderer: news, events, galleries and the other modules' lists.

Same rules as `views.py`: machine client only, tenant from `?host=`, 404 unless the site is
live, no writes and no `record_audit`. Lists are bare arrays capped at `PUBLIC_LIST_MAX`.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.exceptions import NotFound
from rest_framework.request import Request
from rest_framework.response import Response

from apps.website_cms.public import content_serializers as out
from apps.website_cms.public import content_services as feeds
from apps.website_cms.public.views import (
    HOST_PARAMETER,
    NOT_FOUND,
    PAGE_SIZE_PARAMETER,
    PublicContentView,
)
from core.tenancy.models import Tenant

LIST_PARAMETERS = [HOST_PARAMETER, PAGE_SIZE_PARAMETER]
SLUG_PARAMETER = OpenApiParameter(
    "slug", str, location=OpenApiParameter.PATH, description="The item's slug."
)
SCOPE_PARAMETER = OpenApiParameter(
    "scope",
    str,
    enum=list(feeds.EventScope.CHOICES),
    required=False,
    description="`upcoming` (default): not over yet. `past`: over.",
)


class _FeedView(PublicContentView):
    def feed(
        self, request: Request, read: Callable[[Tenant, int], list[dict[str, Any]]]
    ) -> list[dict[str, Any]]:
        """Rows from `read(tenant, limit)` under the bound tenant."""
        tenant = self.get_tenant(request)
        with self.bound(tenant):
            return read(tenant, self.list_limit(request))

    def detail(
        self, request: Request, read: Callable[[Tenant], dict[str, Any] | None]
    ) -> dict[str, Any]:
        """The row from `read(tenant)` under the bound tenant, or 404."""
        tenant = self.get_tenant(request)
        with self.bound(tenant):
            data = read(tenant)
        if data is None:
            raise NotFound
        return data


class PublicNewsPostListView(_FeedView):
    """Published news posts, newest first."""

    @extend_schema(
        operation_id="public_news_posts",
        parameters=LIST_PARAMETERS,
        responses={200: out.PublicNewsPostSerializer(many=True), 404: NOT_FOUND},
    )
    def get(self, request: Request) -> Response:
        rows = self.feed(request, feeds.read_news_list)
        return Response(out.PublicNewsPostSerializer(rows, many=True).data)


class PublicNewsPostView(_FeedView):
    """One published news post by slug."""

    @extend_schema(
        operation_id="public_news_post",
        parameters=[HOST_PARAMETER, SLUG_PARAMETER],
        responses={200: out.PublicNewsPostDetailSerializer, 404: NOT_FOUND},
    )
    def get(self, request: Request, slug: str) -> Response:
        data = self.detail(request, lambda tenant: feeds.read_news_post(tenant, slug))
        return Response(out.PublicNewsPostDetailSerializer(data).data)


class PublicSchoolEventListView(_FeedView):
    """Published events by `scope`: upcoming (soonest first, the default) or past."""

    @extend_schema(
        operation_id="public_school_events",
        parameters=[*LIST_PARAMETERS, SCOPE_PARAMETER],
        responses={200: out.PublicSchoolEventSerializer(many=True), 404: NOT_FOUND},
    )
    def get(self, request: Request) -> Response:
        scope = str(request.query_params.get("scope", feeds.EventScope.UPCOMING))
        if scope not in feeds.EventScope.CHOICES:
            scope = feeds.EventScope.UPCOMING
        rows = self.feed(request, lambda tenant, limit: feeds.read_event_list(tenant, scope, limit))
        return Response(out.PublicSchoolEventSerializer(rows, many=True).data)


class PublicSchoolEventView(_FeedView):
    """One published event by slug."""

    @extend_schema(
        operation_id="public_school_event",
        parameters=[HOST_PARAMETER, SLUG_PARAMETER],
        responses={200: out.PublicSchoolEventDetailSerializer, 404: NOT_FOUND},
    )
    def get(self, request: Request, slug: str) -> Response:
        data = self.detail(request, lambda tenant: feeds.read_event(tenant, slug))
        return Response(out.PublicSchoolEventDetailSerializer(data).data)


class PublicGalleryAlbumListView(_FeedView):
    """Published gallery albums with their item counts."""

    @extend_schema(
        operation_id="public_gallery_albums",
        parameters=LIST_PARAMETERS,
        responses={200: out.PublicGalleryAlbumSerializer(many=True), 404: NOT_FOUND},
    )
    def get(self, request: Request) -> Response:
        rows = self.feed(request, feeds.read_album_list)
        return Response(out.PublicGalleryAlbumSerializer(rows, many=True).data)


class PublicGalleryAlbumView(_FeedView):
    """One published album by slug, with its items (at most 200)."""

    @extend_schema(
        operation_id="public_gallery_album",
        parameters=[HOST_PARAMETER, SLUG_PARAMETER],
        responses={200: out.PublicGalleryAlbumDetailSerializer, 404: NOT_FOUND},
    )
    def get(self, request: Request, slug: str) -> Response:
        data = self.detail(request, lambda tenant: feeds.read_album(tenant, slug))
        return Response(out.PublicGalleryAlbumDetailSerializer(data).data)


class PublicGalleryImageListView(_FeedView):
    """The latest images across published albums."""

    @extend_schema(
        operation_id="public_gallery_items",
        parameters=LIST_PARAMETERS,
        responses={200: out.PublicGalleryImageSerializer(many=True), 404: NOT_FOUND},
    )
    def get(self, request: Request) -> Response:
        rows = self.feed(request, feeds.read_gallery_images)
        return Response(out.PublicGalleryImageSerializer(rows, many=True).data)


class PublicTeacherListView(_FeedView):
    """Staff who opted in to the website, as public teacher cards."""

    @extend_schema(
        operation_id="public_teachers",
        parameters=LIST_PARAMETERS,
        responses={200: out.PublicTeacherSerializer(many=True), 404: NOT_FOUND},
    )
    def get(self, request: Request) -> Response:
        rows = self.feed(request, feeds.read_teachers)
        return Response(out.PublicTeacherSerializer(rows, many=True).data)


class PublicDepartmentListView(_FeedView):
    """Departments that opted in to the website."""

    @extend_schema(
        operation_id="public_departments",
        parameters=LIST_PARAMETERS,
        responses={200: out.PublicDepartmentSerializer(many=True), 404: NOT_FOUND},
    )
    def get(self, request: Request) -> Response:
        rows = self.feed(request, lambda tenant, limit: feeds.read_departments(limit))
        return Response(out.PublicDepartmentSerializer(rows, many=True).data)


class PublicClassListView(_FeedView):
    """Classes that opted in to the website."""

    @extend_schema(
        operation_id="public_classes",
        parameters=LIST_PARAMETERS,
        responses={200: out.PublicClassSerializer(many=True), 404: NOT_FOUND},
    )
    def get(self, request: Request) -> Response:
        rows = self.feed(request, lambda tenant, limit: feeds.read_classes(limit))
        return Response(out.PublicClassSerializer(rows, many=True).data)


class PublicNoticeListView(_FeedView):
    """Published school notices, newest first."""

    @extend_schema(
        operation_id="public_notices",
        parameters=LIST_PARAMETERS,
        responses={200: out.PublicNoticeSerializer(many=True), 404: NOT_FOUND},
    )
    def get(self, request: Request) -> Response:
        rows = self.feed(request, feeds.read_notices)
        return Response(out.PublicNoticeSerializer(rows, many=True).data)
