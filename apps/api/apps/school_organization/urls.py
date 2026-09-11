"""Routes for the school-organization module (module doc §16).

Pure aggregator: every resource declares its own routes in its own package's
``urls.py``, this file just includes them.
"""

from django.urls import include, path

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
    path("", include("apps.school_organization.holiday_calendar.urls")),
]
