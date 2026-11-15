"""Routes of the public content API, mounted at `/api/v1/public/` by the app's `urls.py`.

`TenantMiddleware` exempts `/api/v1/public/`: these views resolve the tenant from `?host=`.
"""

from django.urls import URLPattern, path

from apps.website_cms.public.views import (
    PublicPageView,
    PublicSitemapView,
    PublicSiteView,
    PublicTenantByHostView,
)

urlpatterns: list[URLPattern] = [
    path("tenants/by-host", PublicTenantByHostView.as_view(), name="public-tenant-by-host"),
    path("site", PublicSiteView.as_view(), name="public-site"),
    path("pages", PublicPageView.as_view(), name="public-page"),
    path("sitemap", PublicSitemapView.as_view(), name="public-sitemap"),
]
