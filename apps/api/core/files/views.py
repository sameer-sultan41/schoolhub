"""HTTP layer for the two-step upload flow (api-architecture.md §2.8)."""

from __future__ import annotations

from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.response import Response

from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit
from core.files import services
from core.files.models import File
from core.files.serializers import FileCreateSerializer, FileSerializer


class FileViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """Files (module doc: none — core platform infrastructure, api-architecture.md §2.8).

    No update/delete: a file is immutable once created — the record it is
    referenced from PROTECTs against deletion, and replacing content means
    uploading a new file, not mutating this one.
    """

    # No campus dimension: a File is referenced from several modules under
    # different names, each with related_name="+", so there is no reverse join
    # to hang a campus scope on. See the get_queryset override below.
    scope_campus_field = None
    queryset = File.objects
    serializer_class = FileSerializer
    required_permission = "platform.file.view"
    required_permission_map = {"create": "platform.file.create", "confirm": "platform.file.create"}

    def get_queryset(self):
        # Deliberately does NOT call TenantScopedViewSetMixin.get_queryset(): File has
        # no campus/owner concept of its own — it's referenced from several modules
        # under different names (Student.photo_file, StudentDocument.file, …), each
        # declared with related_name="+" precisely so there's no reverse join to
        # piggyback a campus scope on. The mixin's default scope_campus_field="campus_id"
        # raises FieldError the moment a campus-scoped user (school_admin/principal/
        # teacher) hits list/retrieve/confirm/download. Access control here is tenant
        # RLS + the platform.file.* permission, not record-scope narrowing.
        return File.objects.alive()

    @extend_schema(
        summary="Request a presigned upload slot",
        request=FileCreateSerializer,
        responses={201: FileSerializer},
    )
    def create(self, request, *args, **kwargs) -> Response:
        payload = FileCreateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        file, presigned = services.create_upload(
            tenant_id=request.tenant.pk,
            actor_id=request.user.pk,
            **payload.validated_data,
        )
        record_audit(request, "create", file, after=FileSerializer(file).data)

        data = {**FileSerializer(file).data, **presigned}
        return Response({"data": data}, status=status.HTTP_201_CREATED)

    @extend_schema(
        summary="Confirm a completed upload",
        request=None,
        responses={
            200: FileSerializer,
            409: OpenApiResponse(description="Already confirmed"),
            422: OpenApiResponse(
                description="Upload not found at the storage key, or size mismatch"
            ),
        },
    )
    def confirm(self, request, pk=None) -> Response:
        file = self.get_object()
        before = self.get_serializer(file).data
        file = services.confirm_upload(file=file, actor_id=request.user.pk)
        after = self.get_serializer(file).data
        record_audit(request, "update", file, before=before, after=after)
        return ActionResponse.ok(after, message="Upload confirmed.")

    @extend_schema(
        summary="Get a signed download URL",
        responses={200: OpenApiResponse(description="{'download_url': str}")},
    )
    def download(self, request, pk=None) -> Response:
        file = self.get_object()
        return ActionResponse.ok({"download_url": services.get_download_url(file)})
