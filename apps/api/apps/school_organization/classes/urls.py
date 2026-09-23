"""Routes for `/classes` (module doc §16).

``trailing_slash=False``: the API contract is ``/api/v1/classes``, not
``/api/v1/classes/`` (api-architecture.md §2.1).
"""

from __future__ import annotations

from rest_framework.routers import SimpleRouter

from apps.school_organization.classes.viewset import ClassViewSet

router = SimpleRouter(trailing_slash=False)
router.register("classes", ClassViewSet, basename="classes")

urlpatterns = router.urls
