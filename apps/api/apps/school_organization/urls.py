"""Routes for the school-organization module (module doc §16)."""

from django.urls import include, path

from apps.school_organization.views import HolidayCalendarView, SchoolSettingsView

urlpatterns = [
    path("", include("apps.school_organization.campuses.urls")),
    path("", include("apps.school_organization.departments.urls")),
    path("", include("apps.school_organization.academic_sessions.urls")),
    path("", include("apps.school_organization.terms.urls")),
    path("", include("apps.school_organization.classes.urls")),
    path("", include("apps.school_organization.sections.urls")),
    path("", include("apps.school_organization.subjects.urls")),
    path("", include("apps.school_organization.houses.urls")),
    path("school-settings", SchoolSettingsView.as_view(), name="school-settings"),
    path("holiday-calendar", HolidayCalendarView.as_view(), name="holiday-calendar"),
]
