"""Routes for `/houses` (module doc §16).

``trailing_slash=False``: the API contract is ``/api/v1/houses``, not
``/api/v1/houses/`` (api-architecture.md §2.1).
"""

from __future__ import annotations

from rest_framework.routers import SimpleRouter

from apps.school_organization.houses.viewset import HouseViewSet

router = SimpleRouter(trailing_slash=False)
router.register("houses", HouseViewSet, basename="houses")

urlpatterns = router.urls
