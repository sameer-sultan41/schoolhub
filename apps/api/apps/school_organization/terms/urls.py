"""Routes for `/terms` (module doc §16).

``trailing_slash=False``: the API contract is ``/api/v1/terms``, not
``/api/v1/terms/`` (api-architecture.md §2.1).
"""

from __future__ import annotations

from rest_framework.routers import SimpleRouter

from apps.school_organization.terms.viewset import TermViewSet

router = SimpleRouter(trailing_slash=False)
router.register("terms", TermViewSet, basename="terms")

urlpatterns = router.urls
