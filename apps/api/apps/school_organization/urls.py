"""Routes for the school-organization module (module doc §16).

``trailing_slash=False`` — the API contract is ``/api/v1/campuses``, not
``/api/v1/campuses/`` (api-architecture.md §2.1).
"""

from django.urls import include, path
from rest_framework.routers import SimpleRouter

from apps.school_organization.views import (
    HolidayCalendarView,
    HouseViewSet,
    SchoolSettingsView,
)

router = SimpleRouter(trailing_slash=False)
router.register("houses", HouseViewSet, basename="houses")

urlpatterns = [
    path("", include("apps.school_organization.campuses.urls")),
    path("", include("apps.school_organization.departments.urls")),
    path("", include("apps.school_organization.academic_sessions.urls")),
    path("", include("apps.school_organization.terms.urls")),
    path("", include("apps.school_organization.classes.urls")),
    path("", include("apps.school_organization.sections.urls")),
    path("", include("apps.school_organization.subjects.urls")),
    path("school-settings", SchoolSettingsView.as_view(), name="school-settings"),
    path("holiday-calendar", HolidayCalendarView.as_view(), name="holiday-calendar"),
    *router.urls,
]
