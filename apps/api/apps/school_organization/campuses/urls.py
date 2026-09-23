"""Routes for `/campuses` (module doc §16).

``trailing_slash=False``: the API contract is ``/api/v1/campuses``, not
``/api/v1/campuses/`` (api-architecture.md §2.1).
"""

from __future__ import annotations

from rest_framework.routers import SimpleRouter

from apps.school_organization.campuses.viewset import CampusViewSet

router = SimpleRouter(trailing_slash=False)
router.register("campuses", CampusViewSet, basename="campuses")

urlpatterns = router.urls
