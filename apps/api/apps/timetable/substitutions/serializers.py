"""Serializers for `teacher_substitutions` — timetable.md §7.2.

Shape follows the root `apps.timetable.serializers` module this was cut from:
FKs are exposed with an `_id` suffix over the tenant-scoped default manager (so
a foreign-tenant id fails to resolve and yields a 400 rather than leaking
whether the row exists), explicit `fields` tuples, and lifecycle fields
read-only because they move only through colon-actions.

`validate_substitute_staff_id` delegates to `services.assert_*` rather than
restating a rule: the importer and the attendance-driven substitution feed call
the same services, and a rule implemented twice is a rule that drifts.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.staff_management.models import Staff
from apps.timetable.models import Room, TeacherSubstitution, TimetableSlot
from apps.timetable.serializers import READ_ONLY_FIELDS, _fk
from apps.timetable.services import assert_staff_is_active_teacher


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
        assert_staff_is_active_teacher(value)
        return value
