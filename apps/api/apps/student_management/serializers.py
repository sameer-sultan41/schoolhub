"""Serializers for the student-management module.

Shape validation lives here; rules that need to look at other rows live in
``services`` and are invoked from the viewset (create) or ``validate()``
(update), so the same rule applies whether the write arrives from the API, the
bulk importer or a Celery job.

Foreign keys are exposed with their ``_id`` suffix to match the column names in
docs/05-database/entities/people.md and the filter names in the module doc §16.
"""

from __future__ import annotations

from typing import Any

from rest_framework import serializers

from apps.school_organization.models import Campus, House
from apps.student_management import services
from apps.student_management.models import Student
from core.rbac.models import RecordScope
from core.rbac.permissions import has_permission_key, user_scopes

READ_ONLY_FIELDS = ("id", "created_at", "updated_at")


def _fk(model, **kwargs) -> serializers.PrimaryKeyRelatedField:
    """A tenant-scoped related field — see school_organization/serializers.py's

    identical helper for why the *manager*, not ``manager.all()``, is passed.
    """
    return serializers.PrimaryKeyRelatedField(queryset=model.objects, **kwargs)


class StudentSerializer(serializers.ModelSerializer):
    campus_id = _fk(Campus, source="campus")
    house_id = _fk(House, source="house", required=False, allow_null=True)
    # Explicitly optional: the model column has no `blank=True`, so DRF's
    # ModelSerializer would otherwise auto-derive it as *required* — but the
    # service always generates it server-side on create (views.py's
    # perform_create never reads it out of validated_data) and rejects a
    # changed value on update via validate_admission_number below. A
    # client-supplied value on create is simply ignored, not an error.
    admission_number = serializers.CharField(max_length=32, required=False)

    class Meta:
        model = Student
        fields = (
            "id",
            "admission_number",
            "user_id",
            "first_name",
            "last_name",
            "preferred_name",
            "date_of_birth",
            "gender",
            "photo_file_id",
            "campus_id",
            "house_id",
            "status",
            "admission_date",
            "blood_group",
            "nationality",
            "religion",
            "previous_school",
            "medical_notes",
            "address",
            "custom_fields",
            "created_at",
            "updated_at",
        )
        # admission_number: immutable after creation (§11) — a PATCH carrying it
        # is rejected with a specific message in validate(), not silently
        # dropped, which is why it is NOT listed as read_only here (DRF would
        # drop it before validate() ever saw it).
        # status: moves only through the enroll/change-section/withdraw
        # colon-actions added in a later PR, not a plain PATCH.
        read_only_fields = (*READ_ONLY_FIELDS, "status")

    def validate_admission_number(self, value: str) -> str:
        if self.instance is not None:
            services.assert_admission_number_immutable(instance=self.instance, new_value=value)
        return value

    # No validate() override: creation validates duplicates/user-id/number
    # allocation inside services.create_student, called from the viewset —
    # those checks need a transaction and an actor/tenant id that a plain
    # validate() does not have.

    def to_representation(self, instance: Student) -> dict[str, Any]:
        """Strip medical_notes for callers without the visibility to see it.

        Field-level, not row-level: an update-permission holder or a caller
        whose role carries the `assigned` record scope (a class teacher, whose
        queryset is already narrowed to their own sections) may see it; anyone
        else — including a student/guardian viewing under `own` scope — gets the
        field omitted entirely rather than nulled, so its *absence* is itself
        the signal that the field exists but was withheld (see
        student-profile.tsx's client-side handling of this in the dashboard PR).
        """
        data = super().to_representation(instance)
        request = self.context.get("request")
        user = getattr(request, "user", None) if request else None
        if user is None or not _can_see_medical_notes(user):
            data.pop("medical_notes", None)
        return data


def _can_see_medical_notes(user) -> bool:
    if has_permission_key(user, "students.student.update"):
        return True
    return RecordScope.ASSIGNED in user_scopes(user)
