"""Version 1 route table.

One include per module app. Adding a module means adding one line here and one
entry to MODULE_APPS in settings — nothing else in config/ changes.
"""

from django.urls import include, path

urlpatterns = [
    path("", include("core.rbac.urls")),
    path("", include("core.files.urls")),
    path("", include("core.jobs.urls")),
    path("", include("apps.school_organization.urls")),
    path("", include("apps.student_management.urls")),
    path("", include("apps.staff_management.urls")),
    path("", include("apps.academics.urls")),
]
