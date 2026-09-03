"""Routes for the student-management module (module doc §16).

``trailing_slash=False`` matches the API contract elsewhere — see
school_organization/urls.py. Colon-actions (`:enroll`, `:change-section`,
`:withdraw`, guardian/document/transfer routes) arrive in later PRs and are
declared before ``*router.urls``, same convention.
"""

from rest_framework.routers import SimpleRouter

from apps.student_management.views import StudentViewSet

router = SimpleRouter(trailing_slash=False)
router.register("students", StudentViewSet, basename="students")

urlpatterns = [
    *router.urls,
]
