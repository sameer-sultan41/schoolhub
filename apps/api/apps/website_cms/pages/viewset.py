"""`WebsitePageViewSet` — `/website-pages` (module doc §16)."""

from __future__ import annotations

from django.db.models import Prefetch
from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework_simplejwt.authentication import JWTAuthentication

from apps.website_cms.models import PageSection, WebsitePage
from apps.website_cms.pages import services
from apps.website_cms.pages.filters import WebsitePageFilterSet
from apps.website_cms.pages.serializers import (
    PagePreviewSerializer,
    PageSectionSerializer,
    ReplaceSectionsSerializer,
    WebsitePageDetailSerializer,
    WebsitePageListSerializer,
    WebsitePageUpdateSerializer,
    WebsitePageWriteSerializer,
)
from apps.website_cms.preview import PREVIEW_TOKEN_MAX_AGE, make_preview_token
from apps.website_cms.settings.services import ensure_default_site
from apps.website_cms.urls_builder import tenant_site_url
from apps.website_cms.views import FEATURE, STAFF_PERMISSIONS
from core.api.pagination import PageNumberPagination
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit

PAGE_READ_KEY = "website.page.view"


class WebsitePageViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
    """`website-pages`: pages with their ordered sections, publish workflow and preview."""

    authentication_classes = [JWTAuthentication]
    permission_classes = STAFF_PERMISSIONS
    queryset = WebsitePage.objects
    filterset_class = WebsitePageFilterSet
    search_fields = ["title", "slug"]
    pagination_class = PageNumberPagination
    # `title`, `status` and `page_type` sit behind (tenant, status, page_type) or sort in memory;
    # the table is bounded by one school's page count.
    ordering_fields = [
        "slug",
        "title",
        "status",
        "page_type",
        "published_at",
        "created_at",
        "updated_at",
    ]
    # WebsitePage.Meta.ordering; the view repeats it because DRF reads the view's default.
    ordering = ["slug", "id"]
    scope_campus_field = None
    required_feature = FEATURE
    required_permission = PAGE_READ_KEY
    required_permission_map = {
        "create": "website.page.create",
        "update": "website.page.update",
        "partial_update": "website.page.update",
        "destroy": "website.page.delete",
        "replace_page_sections": "website.page.update",
        "publish": "website.page.publish",
        "unpublish": "website.page.publish",
        "archive": "website.page.publish",
        "preview": PAGE_READ_KEY,
    }
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_serializer_class(self):
        if self.action == "list":
            return WebsitePageListSerializer
        if self.action == "create":
            return WebsitePageWriteSerializer
        if self.action == "partial_update":
            return WebsitePageUpdateSerializer
        return WebsitePageDetailSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.action == "list":
            return queryset
        sections = PageSection.objects.alive().order_by("position", "id")
        return queryset.prefetch_related(Prefetch("sections", queryset=sections))

    def _detail(self, page: WebsitePage) -> dict:
        page = self.get_queryset().get(pk=page.pk)
        return WebsitePageDetailSerializer(page).data

    @extend_schema(request=WebsitePageWriteSerializer, responses={201: WebsitePageDetailSerializer})
    def create(self, request: Request, *args, **kwargs) -> Response:
        serializer = WebsitePageWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ensure_default_site(request.tenant, request.user.pk)
        page = services.create_page(request.tenant, serializer.validated_data, request.user.pk)
        data = self._detail(page)
        record_audit(request, "create", page, after=data)
        return ActionResponse.ok(data, message="Page created.", status=201)

    @extend_schema(
        request=WebsitePageUpdateSerializer, responses={200: WebsitePageDetailSerializer}
    )
    def partial_update(self, request: Request, *args, **kwargs) -> Response:
        page = self.get_object()
        serializer = WebsitePageUpdateSerializer(page, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        before = WebsitePageDetailSerializer(page).data
        page = services.update_page(page, serializer.validated_data, request.user.pk)
        data = self._detail(page)
        record_audit(request, "update", page, before=before, after=data)
        return ActionResponse.ok(data, message="Page updated.")

    @extend_schema(responses={204: None})
    def destroy(self, request: Request, *args, **kwargs) -> Response:
        page = self.get_object()
        before = WebsitePageDetailSerializer(page).data
        services.delete_page(page, request.user)
        record_audit(request, "delete", page, before=before)
        return Response(status=204)

    def _transition(self, request: Request, action_name: str, message: str) -> Response:
        page = self.get_object()
        before = WebsitePageDetailSerializer(page).data
        page = getattr(services, f"{action_name}_page")(page, request.user)
        data = self._detail(page)
        record_audit(request, action_name, page, before=before, after=data)
        return ActionResponse.ok(data, message=message)

    @extend_schema(request=None, responses={200: WebsitePageDetailSerializer})
    def publish(self, request: Request, pk: str) -> Response:
        return self._transition(request, "publish", "Page published.")

    @extend_schema(request=None, responses={200: WebsitePageDetailSerializer})
    def unpublish(self, request: Request, pk: str) -> Response:
        return self._transition(request, "unpublish", "Page unpublished.")

    @extend_schema(request=None, responses={200: WebsitePageDetailSerializer})
    def archive(self, request: Request, pk: str) -> Response:
        return self._transition(request, "archive", "Page archived.")

    @extend_schema(request=None, responses={200: PagePreviewSerializer})
    def preview(self, request: Request, pk: str) -> Response:
        page = self.get_object()
        url = tenant_site_url(request.tenant, f"/api/preview?token={make_preview_token(page)}")
        return ActionResponse.ok(
            PagePreviewSerializer({"url": url, "expires_in": PREVIEW_TOKEN_MAX_AGE}).data
        )

    @extend_schema(
        request=ReplaceSectionsSerializer, responses={200: PageSectionSerializer(many=True)}
    )
    def replace_page_sections(self, request: Request, pk: str) -> Response:
        page = self.get_object()
        serializer = ReplaceSectionsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        before = WebsitePageDetailSerializer(page).data["sections"]
        sections = services.replace_sections(
            page, serializer.validated_data["sections"], request.user
        )
        data = PageSectionSerializer(sections, many=True).data
        record_audit(request, "update", page, before={"sections": before}, after={"sections": data})
        return ActionResponse.ok(data, message="Sections updated.")
