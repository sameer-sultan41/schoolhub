"""Routes of the public content API, mounted at `/api/v1/public/` by the app's `urls.py`.

`TenantMiddleware` exempts `/api/v1/public/`: these views resolve the tenant from `?host=`.
"""

from django.urls import URLPattern, path

from apps.website_cms.media import PUBLIC_FILE_PATH
from apps.website_cms.public.content_views import (
    PublicClassListView,
    PublicDepartmentListView,
    PublicGalleryAlbumListView,
    PublicGalleryAlbumView,
    PublicGalleryImageListView,
    PublicNewsPostListView,
    PublicNewsPostView,
    PublicNoticeListView,
    PublicSchoolEventListView,
    PublicSchoolEventView,
    PublicTeacherListView,
)
from apps.website_cms.public.file_views import PublicFileView
from apps.website_cms.public.views import (
    PublicPageView,
    PublicSitemapView,
    PublicSiteView,
    PublicTenantByHostView,
)

#: The redirect's route, cut from the one `PUBLIC_FILE_PATH` declaration `public_file_url` fills.
FILE_ROUTE = PUBLIC_FILE_PATH.removeprefix("/api/v1/public/").format(
    tenant_id="<uuid:tenant_id>", file_id="<uuid:file_id>"
)

urlpatterns: list[URLPattern] = [
    path("tenants/by-host", PublicTenantByHostView.as_view(), name="public-tenant-by-host"),
    path("site", PublicSiteView.as_view(), name="public-site"),
    path("pages", PublicPageView.as_view(), name="public-page"),
    path("sitemap", PublicSitemapView.as_view(), name="public-sitemap"),
    path("news-posts", PublicNewsPostListView.as_view(), name="public-news-posts"),
    path("news-posts/<slug:slug>", PublicNewsPostView.as_view(), name="public-news-post"),
    path("school-events", PublicSchoolEventListView.as_view(), name="public-school-events"),
    path("school-events/<slug:slug>", PublicSchoolEventView.as_view(), name="public-school-event"),
    path("gallery-albums", PublicGalleryAlbumListView.as_view(), name="public-gallery-albums"),
    path(
        "gallery-albums/<slug:slug>",
        PublicGalleryAlbumView.as_view(),
        name="public-gallery-album",
    ),
    path("gallery-items", PublicGalleryImageListView.as_view(), name="public-gallery-items"),
    path("teachers", PublicTeacherListView.as_view(), name="public-teachers"),
    path("departments", PublicDepartmentListView.as_view(), name="public-departments"),
    path("classes", PublicClassListView.as_view(), name="public-classes"),
    path("notices", PublicNoticeListView.as_view(), name="public-notices"),
    path(FILE_ROUTE, PublicFileView.as_view(), name="public-file"),
]
