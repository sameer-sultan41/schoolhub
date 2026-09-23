"""Routes for `/subjects` (module doc §16).

``trailing_slash=False``: the API contract is ``/api/v1/subjects``, not
``/api/v1/subjects/`` (api-architecture.md §2.1).
"""

from __future__ import annotations

from rest_framework.routers import SimpleRouter

from apps.school_organization.subjects.viewset import SubjectViewSet

router = SimpleRouter(trailing_slash=False)
router.register("subjects", SubjectViewSet, basename="subjects")

urlpatterns = router.urls
