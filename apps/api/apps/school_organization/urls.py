"""Routes for the school-organization module (module doc §16).

``trailing_slash=False`` — the API contract is ``/api/v1/campuses``, not
``/api/v1/campuses/`` (api-architecture.md §2.1).
"""

from django.urls import include, path
from rest_framework.routers import SimpleRouter

from apps.school_organization.views import (
    ClassViewSet,
    HolidayCalendarView,
    HouseViewSet,
    SchoolSettingsView,
    SectionViewSet,
    SubjectViewSet,
    TermViewSet,
)

router = SimpleRouter(trailing_slash=False)
router.register("terms", TermViewSet, basename="terms")
router.register("classes", ClassViewSet, basename="classes")
router.register("sections", SectionViewSet, basename="sections")
router.register("subjects", SubjectViewSet, basename="subjects")
router.register("houses", HouseViewSet, basename="houses")

urlpatterns = [
    path("", include("apps.school_organization.campuses.urls")),
    path("", include("apps.school_organization.departments.urls")),
    path("", include("apps.school_organization.academic_sessions.urls")),
    path("school-settings", SchoolSettingsView.as_view(), name="school-settings"),
    path("holiday-calendar", HolidayCalendarView.as_view(), name="holiday-calendar"),
    *router.urls,
]
