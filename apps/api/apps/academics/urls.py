"""Routes for the academics module (module doc §16).

Pure aggregator: every resource declares its own routes in its own package's
``urls.py``, this file just includes them.
"""

from django.urls import include, path

urlpatterns = [
    path("", include("apps.academics.curriculum.urls")),
    path("", include("apps.academics.teacher_allocations.urls")),
    path("", include("apps.academics.promotions.urls")),
]
