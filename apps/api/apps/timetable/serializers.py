"""Serializers for the timetable module.

Shape follows academics/serializers.py: FKs are exposed with an `_id` suffix over
the tenant-scoped default manager (so a foreign-tenant id fails to resolve and
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

from apps.school_organization.models import AcademicSession, Campus, Section, Subject
from apps.staff_management.models import Staff
from apps.timetable import services
from apps.timetable.models import Period, Room, TeacherSubstitution, TimetableSlot

READ_ONLY_FIELDS = ("id", "created_at", "updated_at")


def _fk(model, **kwargs) -> serializers.PrimaryKeyRelatedField:
    """A related field bound to the model's *tenant-scoped* manager.

    `model.objects`, never `.all()`: the manager is what narrows the lookup to
    the caller's tenant, so a smuggled foreign id simply does not resolve.
    """
    return serializers.PrimaryKeyRelatedField(queryset=model.objects, **kwargs)


class RoomSerializer(serializers.ModelSerializer):
    """`rooms` — physical rooms, labs and halls (§5.4)."""

    campus_id = _fk(Campus, source="campus")

    class Meta:
        model = Room
        fields = (
            "id",
            "campus_id",
            "name",
            "code",
            "room_type",
            "capacity",
            "building",
            "floor",
            "is_active",
            "created_at",
            "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS

    def validate_capacity(self, value: int | None) -> int | None:
        """A zero-capacity room seats nobody, which no slot can ever satisfy.

        The model column is a `PositiveSmallIntegerField`, so 0 is storable and
        would otherwise sit there generating a `room_over_capacity` soft warning
        on every slot forever.
        """
        if value is not None and value < 1:
            raise serializers.ValidationError("A room must seat at least one student.")
        return value


class PeriodSerializer(serializers.ModelSerializer):
    """`periods` — one slot of the bell schedule (§5.1).

    `campus_id` is optional and null means "every campus" (models.py), which is
    why it is `allow_null` rather than merely `required=False`: a client editing
    a campus period back to tenant-wide has to be able to say so explicitly.
    """

    campus_id = _fk(Campus, source="campus", required=False, allow_null=True)

    class Meta:
        model = Period
        fields = (
            "id",
            "campus_id",
            "name",
            "sequence",
            "start_time",
            "end_time",
            "is_break",
            "weekdays",
            "created_at",
            "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS

    def validate_weekdays(self, value):
        """`weekdays` is free-form JSON in the column; §5.1 means 0-6 day indexes.

        Without this a `{"mon": true}` payload stores happily and then silently
        means nothing to every reader of the column.
        """
        if value is None:
            return value
        if not isinstance(value, list) or not all(
            isinstance(day, int) and not isinstance(day, bool) and 0 <= day <= 6 for day in value
        ):
            raise serializers.ValidationError("Expected a list of weekday numbers, 0-6.")
        if len(set(value)) != len(value):
            raise serializers.ValidationError("Weekdays must not repeat.")
        return value

    def validate(self, attrs: dict) -> dict:
        """§11's non-overlap rule, plus the ordering the database also checks.

        The `periods_end_after_start` check constraint would catch a reversed
        pair, but it surfaces as a 409 with no field attached — the same failure
        mode academics' `validate_weekly_periods` exists to avoid — so the
        ordering is mirrored here to give the form a field to highlight.
        """
        start = attrs.get("start_time", getattr(self.instance, "start_time", None))
        end = attrs.get("end_time", getattr(self.instance, "end_time", None))
        if start is not None and end is not None and end <= start:
            raise serializers.ValidationError({"end_time": "The end time must be after the start."})

        campus = attrs.get("campus", getattr(self.instance, "campus", None))
        services.assert_period_does_not_overlap(
            campus_id=campus.pk if campus else None,
            start_time=start,
            end_time=end,
            exclude_pk=self.instance.pk if self.instance else None,
        )
        return attrs


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
            services.assert_staff_is_active_teacher(value)
        return value


class TeacherSubstitutionSerializer(serializers.ModelSerializer):
    """`teacher_substitutions` — a dated override of one slot's teacher (§7.2).

    `status` is read-only: a proposal is confirmed or declined only through
    `:approve` / `:reject`, which is where the notification and the
    already-decided guard live.

    `room_id` is optional and means "move this class for that date only" (§6).
    Its clash check is in the service, not here, because being free depends on
    the slot's period and the date — neither of which a field validator sees.
    """

    timetable_slot_id = _fk(TimetableSlot, source="timetable_slot")
    absent_staff_id = _fk(Staff, source="absent_staff")
    substitute_staff_id = _fk(Staff, source="substitute_staff")
    room_id = _fk(
        Room,
        source="room",
        required=False,
        allow_null=True,
        help_text="Ad-hoc room change for this date only. Omitted = keep the slot's room.",
    )

    class Meta:
        model = TeacherSubstitution
        fields = (
            "id",
            "timetable_slot_id",
            "date",
            "absent_staff_id",
            "substitute_staff_id",
            "room_id",
            "reason",
            "leave_request_id",
            "status",
            "created_at",
            "updated_at",
        )
        # `leave_request_id` stays read-only now that `leave_requests` exists and
        # it is a real foreign key. The reason changed but the answer did not:
        # §7.2 has the absence signal arriving *from* attendance, so the link is
        # set by that module's service when it proposes cover — a client naming
        # one on a hand-created substitution would be asserting a connection
        # nothing checked.
        read_only_fields = (*READ_ONLY_FIELDS, "status", "leave_request_id")

    def validate_substitute_staff_id(self, value: Staff) -> Staff:
        """Fails on the substitute's own field rather than in `non_field`.

        `services.create_substitution` runs the full §11 set anyway; this only
        moves the cheapest and most common failure onto the field the form can
        highlight.
        """
        services.assert_staff_is_active_teacher(value)
        return value


# ---------------------------------------------------------------------------
# Colon-action request bodies and derived read payloads
# ---------------------------------------------------------------------------


class TimetableSessionRequestSerializer(serializers.Serializer):
    """Body of `:validate` and `:publish`.

    The session is optional: a school runs one current session at a time and the
    grid UI has no reason to name it, so an omitted value resolves to the
    tenant's `is_current` session (see `TimetableViewSet._resolve_session`).
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
    """The substitution overlay on one cell of `GET /timetables/my`."""

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
