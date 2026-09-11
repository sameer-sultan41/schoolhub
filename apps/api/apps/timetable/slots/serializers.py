"""Serializers for `timetable-slots`, `:validate`/`:publish`, and `/timetables/my`.

Shape follows the root `apps.timetable.serializers` module this package's
serializers are cut from: FKs are exposed with an `_id` suffix over the
tenant-scoped default manager (so a foreign-tenant id fails to resolve and
yields a 400 rather than leaking whether the row exists), explicit `fields`
tuples, and lifecycle fields read-only because they move only through
colon-actions.

`validate_*` methods delegate to `services.assert_*` rather than restating a
rule: the importer and the attendance-driven substitution feed call the same
services, and a rule implemented twice is a rule that drifts.
"""

from __future__ import annotations

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.school_organization.models import AcademicSession, Section, Subject
from apps.staff_management.models import Staff
from apps.timetable.models import Period, Room, TimetableSlot
from apps.timetable.serializers import READ_ONLY_FIELDS, _fk
from apps.timetable.services import assert_staff_is_active_teacher


class TimetableSlotSerializer(serializers.ModelSerializer):
    """`timetable_slots` — one cell of the weekly grid (§5.2).

    `status` is read-only: a slot becomes published only through
    `POST /timetables/{section_id}:publish`, never by a client writing the field.
    `effective_from`/`effective_to` are read-only for the same reason — they are
    the supersede bookkeeping `publish_section_timetable` writes, and a draft
    that arrived already end-dated would be invisible to the publish it is
    waiting for.
    """

    academic_session_id = _fk(AcademicSession, source="academic_session")
    section_id = _fk(Section, source="section")
    period_id = _fk(Period, source="period")
    subject_id = _fk(Subject, source="subject", required=False, allow_null=True)
    staff_id = _fk(Staff, source="staff", required=False, allow_null=True)
    room_id = _fk(Room, source="room", required=False, allow_null=True)

    class Meta:
        model = TimetableSlot
        fields = (
            "id",
            "academic_session_id",
            "section_id",
            "day_of_week",
            "period_id",
            "subject_id",
            "staff_id",
            "room_id",
            "status",
            "effective_from",
            "effective_to",
            "notes",
            "created_at",
            "updated_at",
        )
        read_only_fields = (*READ_ONLY_FIELDS, "status", "effective_from", "effective_to")

    def validate_day_of_week(self, value: int) -> int:
        """Mirrors `slots_day_of_week_range` so the caller gets a field error."""
        if not 0 <= value <= 6:
            raise serializers.ValidationError("The weekday must be between 0 and 6.")
        return value

    def validate_staff_id(self, value: Staff | None) -> Staff | None:
        """§11: only an active teaching staff member can hold a period.

        Whether they are *allocated* to this section and subject is the conflict
        engine's `teacher_not_allocated` finding, not a validation error — §5.5
        is explicit that a grid mid-build must stay savable.
        """
        if value is not None:
            assert_staff_is_active_teacher(value)
        return value


# ---------------------------------------------------------------------------
# Colon-action request bodies and derived read payloads
# ---------------------------------------------------------------------------


class TimetableSessionRequestSerializer(serializers.Serializer):
    """Body of `:validate` and `:publish`.

    The session is optional: a school runs one current session at a time and the
    grid UI has no reason to name it, so an omitted value resolves to the
    tenant's `is_current` session (see `viewset._resolve_session`).
    """

    academic_session_id = _fk(
        AcademicSession,
        source="academic_session",
        required=False,
        help_text="Defaults to the tenant's current session.",
    )


class MyTimetableQuerySerializer(serializers.Serializer):
    """Query parameters of `GET /timetables/my`.

    Declared as a serializer so drf-spectacular documents both parameters and so
    a malformed `?date=` is a 400 with a field on it rather than a 500 from
    `date.fromisoformat`.
    """

    date = serializers.DateField(
        required=False,
        help_text="Apply confirmed substitutions for this date. Omitted = the base grid.",
    )
    academic_session_id = serializers.UUIDField(
        required=False, help_text="Defaults to the tenant's current session."
    )


class SlotSubstitutionSerializer(serializers.Serializer):
    """The substitution overlay on one cell of `GET /timetables/my`.

    Private to `EffectiveSlotSerializer` — moved alongside it rather than left
    at the root, since nothing else references it.
    """

    id = serializers.UUIDField(read_only=True)
    date = serializers.DateField(read_only=True)
    absent_staff_id = serializers.UUIDField(read_only=True)
    substitute_staff_id = serializers.UUIDField(read_only=True)
    substitute_staff_name = serializers.CharField(read_only=True)
    room_id = serializers.UUIDField(read_only=True, allow_null=True)
    room_name = serializers.CharField(read_only=True, allow_null=True)
    reason = serializers.CharField(read_only=True, allow_null=True)


class EffectiveSlotSerializer(serializers.ModelSerializer):
    """One cell of the caller's effective timetable (§16 `GET /timetables/my`).

    Denormalised deliberately: this is the one endpoint a student, a guardian and
    a teacher all reach, on a phone, and the alternative to inlining the period
    and subject names is four lookups per cell in the client.

    `substitution` comes from the `overrides` map `services.effective_slots_for`
    returns, passed in through the serializer context — never re-queried per row,
    which on a forty-cell week would be forty round trips.
    """

    period_id = serializers.UUIDField(read_only=True)
    period_name = serializers.CharField(source="period.name", read_only=True)
    period_sequence = serializers.IntegerField(source="period.sequence", read_only=True)
    start_time = serializers.TimeField(source="period.start_time", read_only=True)
    end_time = serializers.TimeField(source="period.end_time", read_only=True)
    section_id = serializers.UUIDField(read_only=True)
    section_name = serializers.CharField(source="section.name", read_only=True)
    subject_id = serializers.UUIDField(read_only=True, allow_null=True)
    subject_name = serializers.CharField(source="subject.name", read_only=True, allow_null=True)
    staff_id = serializers.UUIDField(read_only=True, allow_null=True)
    staff_name = serializers.SerializerMethodField()
    room_id = serializers.UUIDField(read_only=True, allow_null=True)
    room_name = serializers.CharField(source="room.name", read_only=True, allow_null=True)
    substitution = serializers.SerializerMethodField()

    class Meta:
        model = TimetableSlot
        fields = (
            "id",
            "day_of_week",
            "period_id",
            "period_name",
            "period_sequence",
            "start_time",
            "end_time",
            "section_id",
            "section_name",
            "subject_id",
            "subject_name",
            "staff_id",
            "staff_name",
            "room_id",
            "room_name",
            "notes",
            "substitution",
        )

    def get_staff_name(self, obj: TimetableSlot) -> str | None:
        if obj.staff is None:
            return None
        return f"{obj.staff.first_name} {obj.staff.last_name}"

    @extend_schema_field(SlotSubstitutionSerializer(allow_null=True))
    def get_substitution(self, obj: TimetableSlot) -> dict | None:
        override = self.context.get("overrides", {}).get(obj.pk)
        if override is None:
            return None
        return SlotSubstitutionSerializer(
            {
                "id": override.pk,
                "date": override.date,
                "absent_staff_id": override.absent_staff_id,
                "substitute_staff_id": override.substitute_staff_id,
                "substitute_staff_name": (
                    f"{override.substitute_staff.first_name} {override.substitute_staff.last_name}"
                ),
                "room_id": override.room_id,
                "room_name": override.room.name if override.room else None,
                "reason": override.reason,
            }
        ).data
