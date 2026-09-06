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

from apps.school_organization import calendar, services
from apps.school_organization.filters import (
    AcademicSessionFilterSet,
    CampusFilterSet,
    ClassFilterSet,
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
    DepartmentSerializer,
    HolidayCalendarSerializer,
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

    # A campus-scoped principal sees the campuses they are scoped to — the row
    # *is* the campus, so the dimension is its own primary key. `campus_id`
    # (the default) is not a column here and raised FieldError.
    scope_campus_field = "id"
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

    # `departments.campus_id` is nullable and means "spans every campus"
    # (models.py). Without this a campus-scoped principal loses exactly those
    # shared departments from the list — silently, since NULL is simply not in
    # an `IN (...)`.
    scope_campus_allows_null = True
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

    # Tenant-wide: a school year is not per-campus. See `scope_queryset`.
    scope_campus_field = None
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

    # Tenant-wide, following its session.
    scope_campus_field = None
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

    # Tenant-wide: "Grade 6" is defined once and every campus uses it. A campus
    # admin must see it to create a section in it.
    scope_campus_field = None
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

    # Tenant-wide, like classes.
    scope_campus_field = None
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


class HouseViewSet(BlockingDestroyMixin, TenantModelViewSet):
    """Houses/groups used for sports, discipline and points (module doc §5.7)."""

    # Tenant-wide: houses span campuses by design.
    scope_campus_field = None
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


class HolidayCalendarView(TenantScopedViewSetMixin, APIView):
    """``GET/PUT /api/v1/holiday-calendar`` — §16's declared calendar resource.

    A projection of ``tenant_settings.academic``, not its own table: see
    ``apps/school_organization/calendar.py``'s header for why the calendar is
    JSONB configuration rather than an entity. It exists as a route separate from
    ``/school-settings`` because §16 declares it separately, and because
    ``it_admin`` adjusting an unplanned closure mid-year (§8) is a different and
    far more frequent act than editing the school profile. It shares the settings
    permission keys, which §4 already describes as covering "academic
    configuration (calendar, timezone, locale, currency)" — inventing
    ``school.holiday-calendar.*`` would put keys in the registry that no module
    doc declares and no seeded role holds.

    PUT rather than PATCH, and §16 says PUT: each list named in the body is
    replaced wholesale. Merging entry by entry would leave no way to *remove* a
    holiday, which is exactly what a cancelled closure needs.

    Mixes in ``TenantScopedViewSetMixin`` for its ``initial()`` tenant binding,
    for the reason ``SchoolSettingsView`` above documents at length: this is a
    plain ``APIView``, so without it ``request.tenant`` is never set and
    ``RequiresModuleFeature`` fails closed on every request.
    """

    permission_classes = [IsAuthenticated, RequiresModuleFeature, HasPermissionKey]
    required_feature = "module.school"
    required_permission = "school.settings.view"
    required_permission_map = {"put": "school.settings.update"}
    serializer_class = HolidayCalendarSerializer

    @extend_schema(responses={200: HolidayCalendarSerializer})
    def get(self, request) -> Response:
        return ActionResponse.ok(self._represent(self._academic(request)))

    @extend_schema(request=HolidayCalendarSerializer, responses={200: HolidayCalendarSerializer})
    def put(self, request) -> Response:
        serializer = HolidayCalendarSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        changes = serializer.validated_data

        settings_row = self._settings(request)
        before = dict(settings_row.academic or {})
        academic = dict(before)

        if "working_days" in changes:
            academic["working_days"] = changes["working_days"]
        if "holidays" in changes:
            academic["holidays"] = [
                {
                    "start_date": entry["start_date"].isoformat(),
                    "end_date": entry["end_date"].isoformat(),
                    "name": entry["name"],
                    "campus_id": str(entry["campus_id"]) if entry.get("campus_id") else None,
                }
                for entry in changes["holidays"]
            ]

        with transaction.atomic():
            settings_row.academic = academic
            settings_row.updated_by = request.user.pk
            settings_row.save(update_fields=["academic", "updated_by", "updated_at"])

        record_audit(
            request,
            "update",
            settings_row,
            before=self._represent(before),
            after=self._represent(academic),
        )
        return ActionResponse.ok(self._represent(academic), message="Calendar updated.")

    @staticmethod
    def _settings(request) -> TenantSettings:
        """One settings row per tenant; provisioning may not have created it yet."""
        row, _ = TenantSettings.objects.get_or_create(
            tenant=request.tenant,
            defaults={"created_by": request.user.pk, "updated_by": request.user.pk},
        )
        return row

    @staticmethod
    def _academic(request) -> dict:
        row = TenantSettings.objects.filter(tenant=request.tenant).first()
        return dict(row.academic or {}) if row is not None else {}

    @staticmethod
    def _represent(academic: dict) -> dict:
        """Answer with the *effective* week, not the stored one.

        A tenant that has configured nothing still operates Monday to Friday
        (``calendar.DEFAULT_WORKING_DAYS``), and a GET that returned an empty
        list would tell the caller the school never opens.
        """
        configured = academic.get("working_days")
        working = (
            sorted({day for day in configured if isinstance(day, int) and 0 <= day <= 6})
            if isinstance(configured, list) and configured
            else list(calendar.DEFAULT_WORKING_DAYS)
        )
        return {"working_days": working, "holidays": academic.get("holidays") or []}
