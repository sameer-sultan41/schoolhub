"""Routes for `/sections` (module doc §16).

``trailing_slash=False``: the API contract is ``/api/v1/sections``, not
``/api/v1/sections/`` (api-architecture.md §2.1).
"""

from __future__ import annotations

from rest_framework.routers import SimpleRouter

from apps.school_organization.sections.viewset import SectionViewSet

router = SimpleRouter(trailing_slash=False)
router.register("sections", SectionViewSet, basename="sections")

urlpatterns = router.urls
