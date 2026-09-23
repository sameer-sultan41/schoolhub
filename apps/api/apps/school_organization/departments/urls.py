"""Routes for `/departments` (module doc §16).

``trailing_slash=False``: the API contract is ``/api/v1/departments``, not
``/api/v1/departments/`` (api-architecture.md §2.1).
"""

from __future__ import annotations

from rest_framework.routers import SimpleRouter

from apps.school_organization.departments.viewset import DepartmentViewSet

router = SimpleRouter(trailing_slash=False)
router.register("departments", DepartmentViewSet, basename="departments")

urlpatterns = router.urls
