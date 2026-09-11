"""Routes for `/academic-sessions` (module doc §16).

The lifecycle transitions are colon-actions (``/academic-sessions/{id}:activate``)
per api-architecture.md §2.2, which a DRF router cannot express, so they are
declared as explicit paths *before* the router's own patterns.
"""

from __future__ import annotations

from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.school_organization.academic_sessions.viewset import AcademicSessionViewSet

router = SimpleRouter(trailing_slash=False)
router.register("academic-sessions", AcademicSessionViewSet, basename="academic-sessions")

urlpatterns = [
    path(
        "academic-sessions/<uuid:pk>:activate",
        AcademicSessionViewSet.as_view({"post": "activate"}),
        name="academic-sessions-activate",
    ),
    path(
        "academic-sessions/<uuid:pk>:close",
        AcademicSessionViewSet.as_view({"post": "close"}),
        name="academic-sessions-close",
    ),
    path(
        "academic-sessions/<uuid:pk>:clone",
        AcademicSessionViewSet.as_view({"post": "clone"}),
        name="academic-sessions-clone",
    ),
    *router.urls,
]
