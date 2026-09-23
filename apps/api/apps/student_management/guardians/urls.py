"""Routes for `/guardians`. No colon-actions — this resource has none."""

from __future__ import annotations

from rest_framework.routers import SimpleRouter

from apps.student_management.guardians.viewset import GuardianViewSet

router = SimpleRouter(trailing_slash=False)
router.register("guardians", GuardianViewSet, basename="guardians")

urlpatterns = [
    *router.urls,
]
