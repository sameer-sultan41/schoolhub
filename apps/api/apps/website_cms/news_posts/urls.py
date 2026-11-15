"""Routes for `/news-posts` (module doc §16); colon-actions precede the detail route."""

from django.urls import path

from apps.website_cms.news_posts.viewset import NewsPostViewSet

urlpatterns = [
    path(
        "news-posts",
        NewsPostViewSet.as_view({"get": "list", "post": "create"}),
        name="news-posts-list",
    ),
    *(
        path(
            f"news-posts/<uuid:pk>:{action}",
            NewsPostViewSet.as_view({"post": action}),
            name=f"news-posts-{action}",
        )
        for action in ("publish", "unpublish", "archive")
    ),
    path(
        "news-posts/<uuid:pk>",
        NewsPostViewSet.as_view(
            {"get": "retrieve", "patch": "partial_update", "delete": "destroy"}
        ),
        name="news-posts-detail",
    ),
]
