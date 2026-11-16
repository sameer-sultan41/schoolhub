"""`NewsPostViewSet` — `/news-posts` (module doc §16)."""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework_simplejwt.authentication import JWTAuthentication

from apps.website_cms.models import NewsPost
from apps.website_cms.news_posts import services
from apps.website_cms.news_posts.filters import NewsPostFilterSet
from apps.website_cms.news_posts.serializers import (
    NewsPostDetailSerializer,
    NewsPostListSerializer,
    NewsPostWriteSerializer,
)
from apps.website_cms.permissions import PAGE_VIEW_KEY
from apps.website_cms.views import FEATURE, STAFF_PERMISSIONS
from core.api.pagination import PageNumberPagination
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit


class NewsPostViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`news-posts`: articles with a rich-text body and a publish workflow."""

    authentication_classes = [JWTAuthentication]
    permission_classes = STAFF_PERMISSIONS
    queryset = NewsPost.objects
    filterset_class = NewsPostFilterSet
    search_fields = ["title", "slug"]
    pagination_class = PageNumberPagination
    ordering_fields = ["title", "slug", "status", "published_at", "created_at", "updated_at"]
    # NewsPost.Meta.ordering; the view repeats it because DRF reads the view's default.
    ordering = ["-published_at", "-created_at", "id"]
    scope_campus_field = None
    required_feature = FEATURE
    required_permission = PAGE_VIEW_KEY
    required_permission_map = {
        "create": "website.news-post.create",
        "update": "website.news-post.update",
        "partial_update": "website.news-post.update",
        "destroy": "website.news-post.delete",
        "publish": "website.news-post.publish",
        "unpublish": "website.news-post.publish",
        "archive": "website.news-post.publish",
    }
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_serializer_class(self):
        if self.action == "list":
            return NewsPostListSerializer
        if self.action in ("create", "partial_update"):
            return NewsPostWriteSerializer
        return NewsPostDetailSerializer

    @extend_schema(request=NewsPostWriteSerializer, responses={201: NewsPostDetailSerializer})
    def create(self, request: Request, *args, **kwargs) -> Response:
        serializer = NewsPostWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        post = services.create_news_post(request.tenant, serializer.validated_data, request.user.pk)
        data = NewsPostDetailSerializer(post).data
        record_audit(request, "create", post, after=data)
        return ActionResponse.ok(data, message="News post created.", status=201)

    @extend_schema(request=NewsPostWriteSerializer, responses={200: NewsPostDetailSerializer})
    def partial_update(self, request: Request, *args, **kwargs) -> Response:
        post = self.get_object()
        serializer = NewsPostWriteSerializer(post, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        before = NewsPostDetailSerializer(post).data
        post = services.update_news_post(post, serializer.validated_data, request.user)
        data = NewsPostDetailSerializer(post).data
        record_audit(request, "update", post, before=before, after=data)
        return ActionResponse.ok(data, message="News post updated.")

    @extend_schema(responses={204: None})
    def destroy(self, request: Request, *args, **kwargs) -> Response:
        post = self.get_object()
        before = NewsPostDetailSerializer(post).data
        services.delete_news_post(post, request.user)
        record_audit(request, "delete", post, before=before)
        return Response(status=204)

    def _transition(self, request: Request, action_name: str, message: str) -> Response:
        post = self.get_object()
        before = NewsPostDetailSerializer(post).data
        post = getattr(services, f"{action_name}_news_post")(post, request.user)
        data = NewsPostDetailSerializer(post).data
        record_audit(request, action_name, post, before=before, after=data)
        return ActionResponse.ok(data, message=message)

    @extend_schema(request=None, responses={200: NewsPostDetailSerializer})
    def publish(self, request: Request, pk: str) -> Response:
        return self._transition(request, "publish", "News post published.")

    @extend_schema(request=None, responses={200: NewsPostDetailSerializer})
    def unpublish(self, request: Request, pk: str) -> Response:
        return self._transition(request, "unpublish", "News post unpublished.")

    @extend_schema(request=None, responses={200: NewsPostDetailSerializer})
    def archive(self, request: Request, pk: str) -> Response:
        return self._transition(request, "archive", "News post archived.")
