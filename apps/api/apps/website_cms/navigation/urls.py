"""Routes for `/navigation-menus` (module doc §16)."""

from django.urls import path

from apps.website_cms.navigation.view import NavigationMenuDetailView, NavigationMenuListView

urlpatterns = [
    path("navigation-menus", NavigationMenuListView.as_view(), name="navigation-menus-list"),
    path(
        "navigation-menus/<str:location>",
        NavigationMenuDetailView.as_view(),
        name="navigation-menus-detail",
    ),
]
