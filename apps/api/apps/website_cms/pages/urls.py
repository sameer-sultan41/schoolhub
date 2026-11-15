"""Routes for `/website-pages` — module doc §16.

Explicit `path()`s, with the colon-actions and the nested `page-sections` route declared
before the bare detail route so none is swallowed by it.
"""

from django.urls import path

from apps.website_cms.pages.viewset import WebsitePageViewSet

urlpatterns = [
    path(
        "website-pages",
        WebsitePageViewSet.as_view({"get": "list", "post": "create"}),
        name="website-pages-list",
    ),
    path(
        "website-pages/<uuid:pk>/page-sections",
        # A bulk replace of one page's sections: neither paginated nor filterable.
        WebsitePageViewSet.as_view(
            {"patch": "replace_page_sections"}, pagination_class=None, filter_backends=[]
        ),
        name="website-pages-sections",
    ),
    *(
        path(
            f"website-pages/<uuid:pk>:{action}",
            WebsitePageViewSet.as_view({"post": action}),
            name=f"website-pages-{action}",
        )
        for action in ("publish", "unpublish", "archive", "preview")
    ),
    path(
        "website-pages/<uuid:pk>",
        WebsitePageViewSet.as_view(
            {"get": "retrieve", "patch": "partial_update", "delete": "destroy"}
        ),
        name="website-pages-detail",
    ),
]
