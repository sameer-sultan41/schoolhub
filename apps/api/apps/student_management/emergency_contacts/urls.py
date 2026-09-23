"""Routes for the EmergencyContact resource — nested under a student
(module doc §16). No top-level route: an emergency contact is reachable only
via `/students/{student_pk}/emergency-contacts`.
"""

from __future__ import annotations

from django.urls import path

from apps.student_management.emergency_contacts.viewset import EmergencyContactLinkViewSet

urlpatterns = [
    path(
        "students/<uuid:student_pk>/emergency-contacts",
        EmergencyContactLinkViewSet.as_view({"get": "list", "post": "create"}),
        name="students-emergency-contacts",
    ),
]
