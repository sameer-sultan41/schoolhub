"""Routes for the platform reports (§13, §16), mounted under `platform/`."""

from django.urls import path

from apps.platform_admin.reports.viewset import PlatformReportViewSet

urlpatterns = [
    path(
        "reports/<slug:key>",
        PlatformReportViewSet.as_view({"get": "retrieve"}),
        name="platform-reports-detail",
    ),
]
