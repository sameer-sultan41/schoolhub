"""Routes for the school-organization module (module doc §16)."""

from django.urls import include, path

from apps.school_organization.views import HolidayCalendarView

urlpatterns = [
    path("", include("apps.school_organization.campuses.urls")),
    path("", include("apps.school_organization.departments.urls")),
    path("", include("apps.school_organization.academic_sessions.urls")),
    path("", include("apps.school_organization.terms.urls")),
    path("", include("apps.school_organization.classes.urls")),
    path("", include("apps.school_organization.sections.urls")),
    path("", include("apps.school_organization.subjects.urls")),
    path("", include("apps.school_organization.houses.urls")),
    path("", include("apps.school_organization.school_settings.urls")),
    path("holiday-calendar", HolidayCalendarView.as_view(), name="holiday-calendar"),
]
