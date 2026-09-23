"""Routes for `/designations`. No colon-actions — this resource has none."""

from __future__ import annotations

from rest_framework.routers import SimpleRouter

from apps.staff_management.designations.viewset import DesignationViewSet

router = SimpleRouter(trailing_slash=False)
router.register("designations", DesignationViewSet, basename="designations")

urlpatterns = [
    *router.urls,
]
