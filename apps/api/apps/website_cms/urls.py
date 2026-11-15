"""Routes for the website module (module doc §16).

Pure aggregator: each resource declares its routes in its own package's ``urls.py``.
"""

from django.urls import URLPattern, URLResolver, include, path

urlpatterns: list[URLPattern | URLResolver] = [
    path("", include("apps.website_cms.settings.urls")),
    path("", include("apps.website_cms.pages.urls")),
    path("", include("apps.website_cms.navigation.urls")),
    path("", include("apps.website_cms.seo.urls")),
    path("", include("apps.website_cms.news_posts.urls")),
    path("", include("apps.website_cms.school_events.urls")),
    path("", include("apps.website_cms.gallery.urls")),
    path("", include("apps.website_cms.contact_submissions.urls")),
    path("", include("apps.website_cms.custom_domains.urls")),
]
