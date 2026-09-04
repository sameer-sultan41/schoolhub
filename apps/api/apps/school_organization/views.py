"""HTTP layer for the school-organization module.

Thin by design: every rule that needs to look at more than the request body lives
in ``services``. Each viewset declares the permission key the endpoint requires —
``HasPermissionKey`` fails closed when one is missing, so an undeclared endpoint
is a 403, not an open door.

``queryset`` is set to the *manager*, not ``manager.all()``. The tenant-scoped
manager resolves the active tenant when its queryset is built, and DRF builds it
per request; ``Model.objects.all()`` evaluated at class-definition time would be
frozen empty because no tenant context exists at import.
"""

from __future__ import annotations

from django.db import transaction
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.school_organization import services
from apps.school_organization.filters import (
    AcademicSessionFilterSet,
    CampusFilterSet,
    ClassFilterSet,
    ClassSubjectFilterSet,
    DepartmentFilterSet,
    HouseFilterSet,
    SectionFilterSet,
    SubjectFilterSet,
    TermFilterSet,
)
from apps.school_organization.models import (
    AcademicSession,
    Campus,
    Class,
    ClassSubject,
    Department,
    House,
    Section,
    Subject,
    Term,
)
from apps.school_organization.serializers import (
    AcademicSessionSerializer,
    CampusSerializer,
    ClassSerializer,
    ClassSubjectSerializer,
    DepartmentSerializer,
    HouseSerializer,
    SchoolSettingsSerializer,
    SectionSerializer,
    SessionCloneSerializer,
    SubjectSerializer,
    TermSerializer,
)
from core.api.permissions import RequiresModuleFeature
from core.api.viewsets import ActionResponse, TenantModelViewSet, TenantScopedViewSetMixin
from core.audit.services import record_audit
from core.rbac.permissions import HasPermissionKey
from core.tenancy.models import TenantSettings


class BlockingDestroyMixin(TenantScopedViewSetMixin):
    """Refuse to delete a structural record that other records still point at (§11).

    The PROTECT foreign keys would stop it anyway, but as an integrity error with
    no useful message; this turns it into a 422 naming the blocking relations.
    """

    def perform_destroy(self, instance) -> None:
        services.assert_deletable(instance)
        super().perform_destroy(instance)


class CampusViewSet(BlockingDestroyMixin, TenantModelViewSet):
    """Campuses/branches of the school (module doc §5.2)."""

    queryset = Campus.objects
    serializer_class = CampusSerializer
    filterset_class = CampusFilterSet
    search_fields = ["name", "code"]
    ordering_fields = ["name", "code", "created_at"]
    required_feature = "module.school"
    required_permission = "school.campus.view"
    required_permission_map = {
        "create": "school.campus.create",
        "update": "school.campus.update",
        "partial_update": "school.campus.update",
        "destroy": "school.campus.delete",
    }

    @transaction.atomic
    def perform_create(self, serializer) -> None:
        if serializer.validated_data.get("is_primary"):
            services.clear_primary_campus(keep_id=None, actor_id=self.request.user.pk)
        super().perform_create(serializer)

    @transaction.atomic
    def perform_update(self, serializer) -> None:
        if serializer.validated_data.get("is_primary"):
            services.clear_primary_campus(
                keep_id=serializer.instance.pk, actor_id=self.request.user.pk
            )
        super().perform_update(serializer)


class DepartmentViewSet(BlockingDestroyMixin, TenantModelViewSet):
    """Academic and administrative departments (module doc §5.3)."""

    queryset = Department.objects
    serializer_class = DepartmentSerializer
    filterset_class = DepartmentFilterSet
    search_fields = ["name", "code"]
    ordering_fields = ["name", "code", "created_at"]
    required_feature = "module.school"
    required_permission = "school.department.view"
    required_permission_map = {
        "create": "school.department.create",
        "update": "school.department.update",
        "partial_update": "school.department.update",
        "destroy": "school.department.delete",
    }

    def get_queryset(self):
        return super().get_queryset().select_related("campus")


class AcademicSessionViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Academic sessions and their lifecycle (module doc §5.4, §7).

    No destroy: §16 exposes no DELETE and §4 grants no delete key. A session that
    should no longer be used is closed, which keeps its history addressable.
    """

    queryset = AcademicSession.objects
    serializer_class = AcademicSessionSerializer
    filterset_class = AcademicSessionFilterSet
    search_fields = ["name"]
    ordering_fields = ["start_date", "name", "created_at"]
    required_feature = "module.school"
    required_permission = "school.academic-session.view"
    required_permission_map = {
        "create": "school.academic-session.create",
        "update": "school.academic-session.update",
        "partial_update": "school.academic-session.update",
        "activate": "school.academic-session.activate",
        "close": "school.academic-session.close",
        "clone": "school.academic-session.create",
    }

    @extend_schema(
        summary="Activate an academic session",
        request=None,
        responses={
            200: AcademicSessionSerializer,
            422: OpenApiResponse(description="Structure incomplete for activation"),
        },
    )
    def activate(self, request, pk=None) -> Response:
        session = self.get_object()
        before = self.get_serializer(session).data
        session = services.activate_session(session, actor_id=request.user.pk)
        after = self.get_serializer(session).data
        record_audit(request, "activate", session, before=before, after=after)
        return ActionResponse.ok(after, message="Session activated.")

    @extend_schema(
        summary="Close an academic session",
        request=None,
        responses={200: AcademicSessionSerializer, 409: OpenApiResponse(description="Not active")},
    )
    def close(self, request, pk=None) -> Response:
        session = self.get_object()
        before = self.get_serializer(session).data
        session = services.close_session(session, actor_id=request.user.pk)
        after = self.get_serializer(session).data
        record_audit(request, "close", session, before=before, after=after)
        return ActionResponse.ok(after, message="Session closed.")

    @extend_schema(
        summary="Clone a session's curriculum into a new session",
        request=SessionCloneSerializer,
        responses={201: AcademicSessionSerializer},
    )
    def clone(self, request, pk=None) -> Response:
        source = self.get_object()
        payload = SessionCloneSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        target = services.clone_session(
            source,
            actor_id=request.user.pk,
            tenant_id=request.tenant.pk,
            **payload.validated_data,
        )
        data = self.get_serializer(target).data
        record_audit(request, "create", target, after=data)
        return ActionResponse.ok(
            data, message=f"Cloned from '{source.name}'.", status=status.HTTP_201_CREATED
        )


class TermViewSet(
    TenantScopedViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Terms of a session. Governed by the academic-session permission keys (§4)."""

    queryset = Term.objects
    serializer_class = TermSerializer
    filterset_class = TermFilterSet
    search_fields = ["name"]
    ordering_fields = ["sequence", "start_date"]
    required_feature = "module.school"
    required_permission = "school.academic-session.view"
    required_permission_map = {
        "create": "school.academic-session.create",
        "update": "school.academic-session.update",
        "partial_update": "school.academic-session.update",
    }

    def get_queryset(self):
        return super().get_queryset().select_related("academic_session")


class ClassViewSet(BlockingDestroyMixin, TenantModelViewSet):
    """Grade levels; ``level`` is the promotion ladder (module doc §5.5)."""

    queryset = Class.objects
    serializer_class = ClassSerializer
    filterset_class = ClassFilterSet
    search_fields = ["name", "code"]
    ordering_fields = ["level", "name", "created_at"]
    required_feature = "module.school"
    required_permission = "school.class.view"
    required_permission_map = {
        "create": "school.class.create",
        "update": "school.class.update",
        "partial_update": "school.class.update",
        "destroy": "school.class.delete",
    }


class SectionViewSet(BlockingDestroyMixin, TenantModelViewSet):
    """Divisions of a class at a campus, with capacity (module doc §5.5)."""

    queryset = Section.objects
    serializer_class = SectionSerializer
    filterset_class = SectionFilterSet
    search_fields = ["name"]
    ordering_fields = ["name", "created_at"]
    required_feature = "module.school"
    required_permission = "school.section.view"
    required_permission_map = {
        "create": "school.section.create",
        "update": "school.section.update",
        "partial_update": "school.section.update",
        "destroy": "school.section.delete",
    }

    def get_queryset(self):
        return super().get_queryset().select_related("school_class", "campus")


class SubjectViewSet(BlockingDestroyMixin, TenantModelViewSet):
    """The tenant's subject catalog (module doc §5.6)."""

    queryset = Subject.objects
    serializer_class = SubjectSerializer
    filterset_class = SubjectFilterSet
    search_fields = ["name", "code"]
    ordering_fields = ["name", "code", "created_at"]
    required_feature = "module.school"
    required_permission = "school.subject.view"
    required_permission_map = {
        "create": "school.subject.create",
        "update": "school.subject.update",
        "partial_update": "school.subject.update",
        "destroy": "school.subject.delete",
    }

    def get_queryset(self):
        return super().get_queryset().select_related("department")


class ClassSubjectViewSet(BlockingDestroyMixin, TenantModelViewSet):
    """Curriculum mapping of subjects onto classes for one session.

    Shares the subject permission keys: mapping a subject to a class is subject
    management, and §4 declares no separate key for it.
    """

    queryset = ClassSubject.objects
    serializer_class = ClassSubjectSerializer
    filterset_class = ClassSubjectFilterSet
    search_fields = ["elective_group"]
    ordering_fields = ["created_at"]
    required_feature = "module.school"
    required_permission = "school.subject.view"
    required_permission_map = {
        "create": "school.subject.create",
        "update": "school.subject.update",
        "partial_update": "school.subject.update",
        "destroy": "school.subject.delete",
    }

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .select_related("academic_session", "school_class", "subject", "campus")
        )

    def perform_create(self, serializer) -> None:
        """Delegate to the service so the wizard, the importer and the API agree.

        The duplicate-mapping check has to live below the serializer: the bulk
        importer never builds one.
        """
        data = serializer.validated_data
        serializer.instance = services.map_subject_to_class(
            session=data["academic_session"],
            school_class=data["school_class"],
            subject=data["subject"],
            campus=data.get("campus"),
            is_elective=data.get("is_elective", False),
            elective_group=data.get("elective_group"),
            weekly_periods=data.get("weekly_periods", 1),
            syllabus_file_id=data.get("syllabus_file_id"),
            term_plans=data.get("term_plans"),
            notes=data.get("notes"),
            actor_id=self.request.user.pk,
            tenant_id=self.request.tenant.pk,
        )
        record_audit(self.request, "create", serializer.instance, after=serializer.data)


class HouseViewSet(BlockingDestroyMixin, TenantModelViewSet):
    """Houses/groups used for sports, discipline and points (module doc §5.7)."""

    queryset = House.objects
    serializer_class = HouseSerializer
    filterset_class = HouseFilterSet
    search_fields = ["name", "code"]
    ordering_fields = ["name", "created_at"]
    required_feature = "module.school"
    required_permission = "school.house.view"
    required_permission_map = {
        "create": "school.house.create",
        "update": "school.house.update",
        "partial_update": "school.house.update",
        "destroy": "school.house.delete",
    }


class SchoolSettingsView(TenantScopedViewSetMixin, APIView):
    """Singleton school profile and academic configuration (module doc §16).

    A singleton rather than a collection because a tenant is one school; the
    branding/academic payloads live in ``tenant_settings`` JSONB while timezone,
    locale and currency stay on the tenant row, which is where the request
    middleware and every other module already read them from.

    Mixes in ``TenantScopedViewSetMixin`` purely for its ``initial()``/
    ``finalize_response()`` tenant binding — this is a plain ``APIView``, not a
    viewset, so the mixin's queryset/create/update helpers are never called and
    are harmless dead code here. Without this, ``request.tenant`` is never set
    (only viewsets get it, via that same mixin), so ``RequiresModuleFeature``
    fails closed on every request before ``is_feature_enabled`` is even checked.
    """

    permission_classes = [IsAuthenticated, RequiresModuleFeature, HasPermissionKey]
    required_feature = "module.school"
    required_permission = "school.settings.view"
    required_permission_map = {"patch": "school.settings.update"}
    serializer_class = SchoolSettingsSerializer

    @extend_schema(responses={200: SchoolSettingsSerializer})
    def get(self, request) -> Response:
        return ActionResponse.ok(self._represent(request, self._settings(request)))

    @extend_schema(request=SchoolSettingsSerializer, responses={200: SchoolSettingsSerializer})
    def patch(self, request) -> Response:
        serializer = SchoolSettingsSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        changes = serializer.validated_data

        settings_row = self._settings(request)
        before = self._represent(request, settings_row)

        with transaction.atomic():
            for field in ("branding", "academic"):
                if field in changes:
                    setattr(settings_row, field, changes[field])
            settings_row.updated_by = request.user.pk
            settings_row.save()

            tenant = request.tenant
            tenant_fields = [f for f in ("timezone", "locale", "currency") if f in changes]
            for field in tenant_fields:
                setattr(tenant, field, changes[field])
            if tenant_fields:
                tenant.updated_by = request.user.pk
                tenant.save(update_fields=[*tenant_fields, "updated_by", "updated_at"])

        after = self._represent(request, settings_row)
        record_audit(request, "update", settings_row, before=before, after=after)
        return ActionResponse.ok(after, message="School settings updated.")

    @staticmethod
    def _settings(request) -> TenantSettings:
        """One settings row per tenant; provisioning may not have created it yet."""
        row, _ = TenantSettings.objects.get_or_create(
            tenant=request.tenant,
            defaults={"created_by": request.user.pk, "updated_by": request.user.pk},
        )
        return row

    @staticmethod
    def _represent(request, settings_row: TenantSettings) -> dict:
        tenant = request.tenant
        return {
            "branding": settings_row.branding,
            "academic": settings_row.academic,
            "timezone": tenant.timezone,
            "locale": tenant.locale,
            "currency": tenant.currency,
        }
