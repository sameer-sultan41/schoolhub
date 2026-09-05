"""Routes for the school-organization module (module doc §16).

Two things are deliberate here:

* ``trailing_slash=False`` — the API contract is ``/api/v1/campuses``, not
  ``/api/v1/campuses/`` (api-architecture.md §2.1).
* The lifecycle transitions are colon-actions (``/academic-sessions/{id}:activate``)
  per api-architecture.md §2.2, which a DRF router cannot express, so they are
  declared as explicit paths *before* the router's own patterns.
"""

from django.urls import path
from rest_framework.routers import SimpleRouter

from apps.school_organization.views import (
    AcademicSessionViewSet,
    CampusViewSet,
    ClassViewSet,
    DepartmentViewSet,
    HouseViewSet,
    SchoolSettingsView,
    SectionViewSet,
    SubjectViewSet,
    TermViewSet,
)

router = SimpleRouter(trailing_slash=False)
router.register("campuses", CampusViewSet, basename="campuses")
router.register("departments", DepartmentViewSet, basename="departments")
router.register("academic-sessions", AcademicSessionViewSet, basename="academic-sessions")
router.register("terms", TermViewSet, basename="terms")
router.register("classes", ClassViewSet, basename="classes")
router.register("sections", SectionViewSet, basename="sections")
router.register("subjects", SubjectViewSet, basename="subjects")
router.register("houses", HouseViewSet, basename="houses")

urlpatterns = [
    path("school-settings", SchoolSettingsView.as_view(), name="school-settings"),
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
