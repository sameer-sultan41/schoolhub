"""Routes for the timetable module (module doc §16).

Pure aggregator: every resource declares its own routes in its own package's
``urls.py``, this file just includes them.
"""

from django.urls import include, path

urlpatterns = [
    path("", include("apps.timetable.rooms.urls")),
    path("", include("apps.timetable.periods.urls")),
    path("", include("apps.timetable.slots.urls")),
    path("", include("apps.timetable.substitutions.urls")),
]
