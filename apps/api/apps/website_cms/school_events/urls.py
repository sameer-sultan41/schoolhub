"""Routes for `/school-events` — module doc §16; no DELETE route (§4 has no key for it)."""

from django.urls import path

from apps.website_cms.school_events.viewset import SchoolEventViewSet

urlpatterns = [
    path(
        "school-events",
        SchoolEventViewSet.as_view({"get": "list", "post": "create"}),
        name="school-events-list",
    ),
    *(
        path(
            f"school-events/<uuid:pk>:{action}",
            SchoolEventViewSet.as_view({"post": action}),
            name=f"school-events-{action}",
        )
        for action in ("publish", "unpublish", "archive")
    ),
    path(
        "school-events/<uuid:pk>",
        SchoolEventViewSet.as_view({"get": "retrieve", "patch": "partial_update"}),
        name="school-events-detail",
    ),
]
