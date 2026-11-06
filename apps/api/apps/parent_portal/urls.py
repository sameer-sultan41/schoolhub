"""Routes for the parent portal (module doc §16)."""

from django.urls import path

from apps.parent_portal.views import DashboardView

urlpatterns = [
    path("parent-portal/dashboard", DashboardView.as_view(), name="parent-portal-dashboard"),
]
