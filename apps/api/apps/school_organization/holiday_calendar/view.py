"""`HolidayCalendarView` — `GET/PUT /holiday-calendar` (module doc §16).

No split into per-action files: a singleton resource has no distinct actions
the way `academic_sessions` does, so one file holds the whole view — the same
shape `school_settings/view.py` uses in this module, and `apps/communication`'s
`preferences/view.py` uses for its own singleton resource (PR #73, adopting
the same file-per-action layout independently).
"""

from __future__ import annotations

from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.school_organization import calendar
from apps.school_organization.holiday_calendar.serializers import HolidayCalendarSerializer
from apps.school_organization.tenant_settings import get_settings_row
from core.api.permissions import RequiresModuleFeature
from core.api.viewsets import ActionResponse, TenantScopedViewSetMixin
from core.audit.services import record_audit
from core.rbac.permissions import HasPermissionKey
from core.tenancy.models import TenantSettings


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

    Mixes in ``TenantScopedViewSetMixin`` for its ``initial()`` tenant binding:
    this is a plain ``APIView``, so without it ``request.tenant`` is never set
    and ``RequiresModuleFeature`` fails closed on every request before
    ``is_feature_enabled`` is even checked — the same reason
    ``school_settings/view.py::SchoolSettingsView`` mixes it in too.
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

        settings_row = get_settings_row(request)
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
