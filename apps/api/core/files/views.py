"""HTTP layer for the two-step upload flow (api-architecture.md §2.8)."""

from __future__ import annotations

from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.response import Response

from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit
from core.files import services
from core.files.models import File
from core.files.purposes import registry as upload_purposes
from core.files.serializers import FileCreateSerializer, FileSerializer
from core.rbac.permissions import is_restricted_principal

# The uploader confirms their own upload through this viewset, module-gated or not;
# every other read here is generic and must not reach a module-gated file.
MODULE_GATED_ACTIONS_ALLOWED = frozenset({"confirm"})


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
    # to hang a campus scope on.
    #
    # Declarative only today — `get_queryset` below bypasses the mixin's scoping
    # entirely, so nothing reads this. It stays because the two must not
    # disagree: if that override is ever dropped in favour of the mixin, the
    # default `"campus_id"` would resolve to a column this model does not have
    # and 500, which is exactly the bug this attribute was introduced to end.
    scope_campus_field = None
    queryset = File.objects
    serializer_class = FileSerializer
    # Explicit rather than left to DRF's serializer fallback: without an allowlist an
    # ?ordering= could reach any field the serializer exposes, on a table every module
    # writes to. Upload time is the only order this list is ever read in.
    ordering_fields = ["created_at"]
    ordering = ["-created_at"]
    required_permission = "platform.file.view"
    required_permission_map = {
        "create": "platform.file.create",
        "confirm": "platform.file.create",
        # A read over POST: issuing a short-lived signed URL changes nothing, and the registry
        # defines platform.file.view as exactly this. Mapped explicitly so it isn't a fallback.
        "download": "platform.file.view",
    }
    # A guardian confirms their own slot without platform.file.view (get_queryset narrows it).
    scope_read_exempt_actions = frozenset({"confirm"})

    def get_queryset(self):
        # Deliberately does NOT call TenantScopedViewSetMixin.get_queryset(): File has
        # no campus/owner concept of its own — it's referenced from several modules
        # under different names (Student.photo_file, StudentDocument.file, …), each
        # declared with related_name="+" precisely so there's no reverse join to
        # piggyback a campus scope on. The mixin's default scope_campus_field="campus_id"
        # raises FieldError the moment a campus-scoped user (school_admin/principal/
        # teacher) hits list/retrieve/confirm/download. Access control here is tenant
        # RLS + the platform.file.* permission, not record-scope narrowing.
        #
        # A module-gated purpose (core/files/purposes.py) is the exception: its files are
        # listed and signed only by the owning module's record-gated endpoint, so here they
        # are absent from the list and a 404 on retrieve and :download.
        queryset = File.objects.alive()
        if self.action in MODULE_GATED_ACTIONS_ALLOWED:
            # A guardian or student confirms only the slot they requested themselves.
            if is_restricted_principal(self.request.user):
                queryset = queryset.filter(created_by=self.request.user.pk)
            return queryset
        return queryset.exclude(purpose__in=upload_purposes.module_gated_keys())

    @extend_schema(
        summary="Request a presigned upload slot",
        request=FileCreateSerializer,
        responses={201: FileSerializer},
    )
    def create(self, request, *args, **kwargs) -> Response:
        payload = FileCreateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        if is_restricted_principal(request.user):
            services.assert_portal_may_upload(purpose=payload.validated_data["purpose"])

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
