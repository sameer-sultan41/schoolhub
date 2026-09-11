"""Routes for the staff-management module (module doc §16).

Pure aggregator: every resource declares its own routes in its own package's
``urls.py``, this file just includes them.
"""

from django.urls import include, path

urlpatterns = [
    path("", include("apps.staff_management.staff.urls")),
    path("", include("apps.staff_management.designations.urls")),
    path("", include("apps.staff_management.staff_qualifications.urls")),
    path("", include("apps.staff_management.staff_documents.urls")),
]
