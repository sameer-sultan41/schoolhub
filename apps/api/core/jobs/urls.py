from rest_framework.routers import SimpleRouter

from core.jobs.views import JobViewSet

router = SimpleRouter(trailing_slash=False)
router.register("jobs", JobViewSet, basename="jobs")

urlpatterns = [
    *router.urls,
]
