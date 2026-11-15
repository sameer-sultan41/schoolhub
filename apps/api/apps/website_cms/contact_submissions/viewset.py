"""`ContactSubmissionViewSet` — `/contact-submissions` (module doc §16)."""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework import mixins, viewsets
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework_simplejwt.authentication import JWTAuthentication

from apps.website_cms.contact_submissions import services
from apps.website_cms.contact_submissions.filters import ContactSubmissionFilterSet
from apps.website_cms.contact_submissions.serializers import (
    ContactSubmissionSerializer,
    ContactSubmissionTriageSerializer,
)
from apps.website_cms.models import ContactSubmission
from apps.website_cms.views import FEATURE, STAFF_PERMISSIONS
from core.api.pagination import PageNumberPagination
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit


class ContactSubmissionViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """`contact-submissions`: the inbox. Rows arrive from the public form, never from staff."""

    authentication_classes = [JWTAuthentication]
    permission_classes = STAFF_PERMISSIONS
    queryset = ContactSubmission.objects
    serializer_class = ContactSubmissionSerializer
    filterset_class = ContactSubmissionFilterSet
    search_fields = ["name", "email", "subject", "message"]
    pagination_class = PageNumberPagination
    ordering_fields = ["created_at", "status", "name"]
    # ContactSubmission.Meta.ordering; the view repeats it because DRF reads the view's default.
    ordering = ["-created_at", "id"]
    scope_campus_field = None
    required_feature = FEATURE
    required_permission = "website.contact-submission.view"
    required_permission_map = {"partial_update": "website.contact-submission.update"}
    http_method_names = ["get", "patch", "head", "options"]

    @extend_schema(
        request=ContactSubmissionTriageSerializer, responses={200: ContactSubmissionSerializer}
    )
    def partial_update(self, request: Request, *args, **kwargs) -> Response:
        submission = self.get_object()
        serializer = ContactSubmissionTriageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        before = ContactSubmissionSerializer(submission).data
        submission = services.set_status(
            submission.pk, serializer.validated_data["status"], request.user
        )
        data = ContactSubmissionSerializer(submission).data
        record_audit(request, "update", submission, before=before, after=data)
        return ActionResponse.ok(data, message="Contact submission updated.")
