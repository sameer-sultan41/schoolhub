"""`StaffDocumentLinkViewSet` (nested) and `StaffDocumentViewSet` (top-level) —
request handling for `/staff/{staff_pk}/documents` and `/staff-documents`
(module doc §5.x / §16).
"""

from __future__ import annotations

from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import mixins, viewsets
from rest_framework.response import Response

from apps.staff_management.models import StaffDocument
from apps.staff_management.serializers import VerifyRequestSerializer
from apps.staff_management.staff_documents.serializers import StaffDocumentSerializer
from apps.staff_management.staff_documents.services import add_staff_document, verify_document
from apps.staff_management.views import _NestedUnderStaffMixin, _StaffModuleViewSetMixin
from core.api.viewsets import ActionResponse


class StaffDocumentLinkViewSet(
    _NestedUnderStaffMixin,
    _StaffModuleViewSetMixin,
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    """`GET/POST /staff/{staff_pk}/documents`."""

    queryset = StaffDocument.objects
    serializer_class = StaffDocumentSerializer
    # See StaffQualificationLinkViewSet — one staff member's vault, so the sort is
    # over a handful of rows; `verification_status` (staff_documents_status_idx)
    # and `created_at` are the index-backed two.
    ordering_fields = ["document_type", "title", "verification_status", "expires_at", "created_at"]
    required_feature = "module.staff"
    required_permission = "staff.document.view"
    required_permission_map = {"create": "staff.document.create"}
    scope_campus_field = "staff__campus_id"

    def get_queryset(self):
        return super().get_queryset().filter(staff=self.get_staff())

    def perform_create(self, serializer) -> None:
        from core.audit.services import record_audit

        data = serializer.validated_data
        serializer.instance = add_staff_document(
            staff=self.get_staff(),
            file=data["file"],
            document_type=data["document_type"],
            title=data["title"],
            notes=data.get("notes"),
            expires_at=data.get("expires_at"),
            actor_id=self.request.user.pk,
            tenant_id=self.request.tenant.pk,
        )
        record_audit(self.request, "create", serializer.instance, after=serializer.data)


class StaffDocumentViewSet(
    _StaffModuleViewSetMixin,
    mixins.RetrieveModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """Top-level access for `DELETE /staff-documents/{id}` and `:verify`."""

    queryset = StaffDocument.objects
    serializer_class = StaffDocumentSerializer
    required_feature = "module.staff"
    required_permission = "staff.document.view"
    required_permission_map = {
        "destroy": "staff.document.delete",
        "verify": "staff.document.verify",
    }
    scope_campus_field = "staff__campus_id"

    @extend_schema(
        summary="Verify or reject a staff document",
        request=VerifyRequestSerializer,
        responses={
            200: StaffDocumentSerializer,
            409: OpenApiResponse(description="Already decided"),
        },
    )
    def verify(self, request, pk=None) -> Response:
        from core.audit.services import record_audit

        payload = VerifyRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        document = self.get_object()
        before = self.get_serializer(document).data
        document = verify_document(
            document=document,
            decision=payload.validated_data["decision"],
            actor_id=request.user.pk,
        )
        after = self.get_serializer(document).data
        record_audit(request, "verify", document, before=before, after=after)
        return ActionResponse.ok(after, message=f"Document {document.verification_status}.")
