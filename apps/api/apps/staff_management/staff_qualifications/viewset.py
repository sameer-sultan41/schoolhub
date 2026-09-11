"""HTTP layer for the staff-qualifications resource.

Thin by design: every rule that needs to look at more than the request body
lives in ``staff_qualifications.services``. See core.api.viewsets for what
``queryset = StaffQualification.objects`` (the manager, never ``.all()``) buys.

``_NestedUnderStaffMixin`` and ``_StaffModuleViewSetMixin`` stay in the module
root's ``views.py`` — the former is shared with ``staff_documents``'s link
viewset, the latter adds ``DenyRestrictedPrincipals`` on top of the base
tenant-scoped permission stack for every staff endpoint.
"""

from __future__ import annotations

from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import mixins, viewsets
from rest_framework.response import Response

from apps.staff_management.models import StaffQualification
from apps.staff_management.serializers import VerifyRequestSerializer
from apps.staff_management.staff_qualifications.serializers import StaffQualificationSerializer
from apps.staff_management.staff_qualifications.services import (
    add_staff_qualification,
    verify_qualification,
)
from apps.staff_management.views import _NestedUnderStaffMixin, _StaffModuleViewSetMixin
from core.api.viewsets import ActionResponse


class StaffQualificationLinkViewSet(
    _NestedUnderStaffMixin,
    _StaffModuleViewSetMixin,
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    """`GET/POST /staff/{staff_pk}/qualifications`."""

    queryset = StaffQualification.objects
    serializer_class = StaffQualificationSerializer
    # Declared for the same reason DesignationViewSet's is: a list that names no
    # allowlist is sortable by every serializer field, not by none. This one is
    # already narrowed to a single staff member, so the sort is over a handful of
    # rows and only `qualification_type` (staff_qual_type_idx) and `created_at`
    # are index-backed anyway.
    ordering_fields = ["qualification_type", "title", "year_awarded", "created_at"]
    required_feature = "module.staff"
    required_permission = "staff.qualification.view"
    required_permission_map = {"create": "staff.qualification.create"}
    scope_campus_field = "staff__campus_id"

    def get_queryset(self):
        return super().get_queryset().filter(staff=self.get_staff())

    def perform_create(self, serializer) -> None:
        from core.audit.services import record_audit

        data = serializer.validated_data
        serializer.instance = add_staff_qualification(
            staff=self.get_staff(),
            qualification_type=data["qualification_type"],
            title=data["title"],
            institution=data.get("institution"),
            field_of_study=data.get("field_of_study"),
            year_awarded=data.get("year_awarded"),
            grade=data.get("grade"),
            document_file=data.get("document_file"),
            actor_id=self.request.user.pk,
            tenant_id=self.request.tenant.pk,
        )
        record_audit(self.request, "create", serializer.instance, after=serializer.data)


class StaffQualificationViewSet(
    _StaffModuleViewSetMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Top-level access for `PATCH /staff-qualifications/{id}` and `:verify`."""

    queryset = StaffQualification.objects
    serializer_class = StaffQualificationSerializer
    required_feature = "module.staff"
    required_permission = "staff.qualification.view"
    required_permission_map = {
        "update": "staff.qualification.update",
        "partial_update": "staff.qualification.update",
        "verify": "staff.qualification.verify",
    }
    # §16 declares no PUT (same convention as StaffViewSet); "post" must stay
    # allowed for the hand-wired :verify action — View.dispatch() checks
    # http_method_names before the URL's own {"post": "verify"} map ever
    # runs, so omitting it here 405s that action regardless of urls.py.
    http_method_names = ["get", "patch", "post", "head", "options"]
    scope_campus_field = "staff__campus_id"

    @extend_schema(
        summary="Verify or reject a staff qualification",
        request=VerifyRequestSerializer,
        responses={
            200: StaffQualificationSerializer,
            409: OpenApiResponse(description="Already decided"),
        },
    )
    def verify(self, request, pk=None) -> Response:
        from core.audit.services import record_audit

        payload = VerifyRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        qualification = self.get_object()
        before = self.get_serializer(qualification).data
        qualification = verify_qualification(
            qualification=qualification,
            decision=payload.validated_data["decision"],
            actor_id=request.user.pk,
        )
        after = self.get_serializer(qualification).data
        record_audit(request, "verify", qualification, before=before, after=after)
        return ActionResponse.ok(
            after, message=f"Qualification {qualification.verification_status}."
        )
