"""Serializers for the student-management module.

Shape validation lives here; rules that need to look at other rows live in
``services`` and are invoked from the viewset (create) or ``validate()``
(update), so the same rule applies whether the write arrives from the API, the
bulk importer or a Celery job.

Foreign keys are exposed with their ``_id`` suffix to match the column names in
docs/05-database/entities/people.md and the filter names in the module doc §16.
"""

from __future__ import annotations

import uuid
from typing import Any

from rest_framework import serializers

from apps.school_organization.models import AcademicSession, Campus, Class, House, Section
from apps.student_management import services
from apps.student_management.models import (
    EmergencyContact,
    Guardian,
    Student,
    StudentDocument,
    StudentEnrollment,
    StudentGuardian,
    StudentTransfer,
)
from core.files.models import File
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
    photo_file_id = _fk(File, source="photo_file", required=False, allow_null=True)
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

    def validate_user_id(self, value: uuid.UUID | None) -> uuid.UUID | None:
        """Re-run on every write, not just create.

        ``TenantScopedViewSetMixin.perform_update`` saves a PATCH straight through
        with no tenant-ownership recheck of its own (unlike ``perform_create``,
        which every model here bypasses in favor of a service function precisely
        so this kind of check has somewhere to live). ``user_id`` is a plain UUID
        column, not a ForeignKey — see the model docstring — so without this,
        DRF's auto-generated field accepts any syntactically valid UUID, including
        another tenant's user id.
        """
        tenant = self.context["request"].tenant
        return services.resolve_tenant_user_id(user_id=value, tenant_id=tenant.pk)

    # No validate() override for cross-row create-time rules (duplicates,
    # admission-number allocation): those need a transaction and an actor id a
    # plain validate() does not have, so they live in services.create_student,
    # called from the viewset instead.

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
        if user is None or not _can_see_medical_notes(user, instance):
            data.pop("medical_notes", None)
        return data


def _can_see_medical_notes(user, student: Student) -> bool:
    if has_permission_key(user, "students.student.update"):
        return True
    if RecordScope.ASSIGNED not in user_scopes(user):
        return False
    # A user can hold `assigned` scope from one role and a broader scope (e.g.
    # `campus`) from another — the aggregate scope set alone can't say which one
    # actually reached *this* record. Re-run the module's own assigned-filter
    # against just this instance rather than trusting scope membership in general.
    return Student.filter_assigned_to_user(Student.objects.filter(pk=student.pk), user).exists()


class GuardianSerializer(serializers.ModelSerializer):
    photo_file_id = _fk(File, source="photo_file", required=False, allow_null=True)

    class Meta:
        model = Guardian
        fields = (
            "id",
            "user_id",
            "first_name",
            "last_name",
            "phone",
            "alt_phone",
            "email",
            "occupation",
            "employer",
            "national_id",
            "photo_file_id",
            "address",
            "custom_fields",
            "created_at",
            "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS

    def validate_photo_file_id(self, value: File | None) -> File | None:
        # Mirrors Student.photo_file/StudentDocument.file: a resolved File still
        # needs its purpose and upload-confirmed status checked — the tenant-scoped
        # `_fk()` field only proves the id exists and belongs to this tenant.
        if value is not None:
            services.assert_file_usable(file=value, purpose="guardian.photo")
        return value


class StudentGuardianSerializer(serializers.ModelSerializer):
    """Used both for the nested `POST /students/{id}/guardians` (student comes

    from the URL, not the body — see the view) and the top-level
    `PATCH /student-guardians/{id}` (link-flag updates only).
    """

    student_id = serializers.UUIDField(read_only=True)
    guardian_id = _fk(Guardian, source="guardian")

    class Meta:
        model = StudentGuardian
        fields = (
            "id",
            "student_id",
            "guardian_id",
            "relationship",
            "is_primary",
            "is_fee_responsible",
            "can_pick_up",
            "receives_communications",
            "has_portal_access",
            "access_revoked_reason",
            "created_at",
            "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS


class EmergencyContactSerializer(serializers.ModelSerializer):
    student_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = EmergencyContact
        fields = (
            "id",
            "student_id",
            "name",
            "relationship",
            "phone",
            "alt_phone",
            "priority",
            "notes",
            "created_at",
            "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS


class StudentDocumentSerializer(serializers.ModelSerializer):
    student_id = serializers.UUIDField(read_only=True)
    file_id = _fk(File, source="file")

    class Meta:
        model = StudentDocument
        fields = (
            "id",
            "student_id",
            "file_id",
            "document_type",
            "title",
            "notes",
            "verification_status",
            "verified_by",
            "verified_at",
            "expires_at",
            "created_at",
            "updated_at",
        )
        # verification_status/verified_by/verified_at move only through the
        # :verify colon-action (§4: "verification only by users holding
        # students.document.verify") — never a plain PATCH.
        read_only_fields = (
            *READ_ONLY_FIELDS,
            "verification_status",
            "verified_by",
            "verified_at",
        )

    def validate_document_type(self, value: str) -> str:
        tenant = self.context["request"].tenant
        services.assert_document_type_allowed(document_type=value, tenant_id=tenant.pk)
        return value


class DocumentVerifyRequestSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=["verified", "rejected"])


class StudentEnrollmentSerializer(serializers.ModelSerializer):
    """Output-only — enrollments are created/changed through the :enroll and

    :change-section colon-actions on StudentViewSet, never a plain serializer
    save().
    """

    # Plain read-only UUID fields, not _fk(): PrimaryKeyRelatedField asserts
    # against combining `queryset=` with `read_only=True`, and these never
    # accept input — see the class docstring.
    student_id = serializers.UUIDField(read_only=True)
    academic_session_id = serializers.UUIDField(read_only=True)
    class_id = serializers.UUIDField(source="school_class_id", read_only=True)
    section_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = StudentEnrollment
        fields = (
            "id",
            "student_id",
            "academic_session_id",
            "class_id",
            "section_id",
            "roll_number",
            "enrollment_date",
            "end_date",
            "status",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields


class EnrollRequestSerializer(serializers.Serializer):
    academic_session_id = _fk(AcademicSession, source="academic_session")
    class_id = _fk(Class, source="school_class")
    section_id = _fk(Section, source="section")
    enrollment_date = serializers.DateField()
    roll_number = serializers.CharField(max_length=16, required=False, allow_null=True)
    capacity_override_reason = serializers.CharField(required=False, allow_null=True)


class ChangeSectionRequestSerializer(serializers.Serializer):
    section_id = _fk(Section, source="section")
    roll_number = serializers.CharField(max_length=16, required=False, allow_null=True)
    capacity_override_reason = serializers.CharField(required=False, allow_null=True)


class WithdrawRequestSerializer(serializers.Serializer):
    reason = serializers.CharField()
    effective_date = serializers.DateField()
    waive_clearance = serializers.BooleanField(required=False, default=False)


class StudentTransferSerializer(serializers.ModelSerializer):
    student_id = _fk(Student, source="student")
    from_campus_id = _fk(Campus, source="from_campus", required=False, allow_null=True)
    to_campus_id = _fk(Campus, source="to_campus", required=False, allow_null=True)

    class Meta:
        model = StudentTransfer
        fields = (
            "id",
            "student_id",
            "transfer_type",
            "from_campus_id",
            "to_campus_id",
            "external_school_name",
            "reason",
            "status",
            "effective_date",
            "decided_by",
            "decided_at",
            "certificate_document_id",
            "created_at",
            "updated_at",
        )
        # status/decided_by/decided_at/certificate_document_id move only
        # through the :approve/:reject/:complete colon-actions.
        read_only_fields = (
            *READ_ONLY_FIELDS,
            "status",
            "decided_by",
            "decided_at",
            "certificate_document_id",
        )


class TransferCompleteRequestSerializer(serializers.Serializer):
    """`section_id` is required only for an inter-campus transfer — see

    services.complete_transfer, which raises a field-specific error when it is
    missing for that type rather than this serializer guessing at a
    conditional-required rule.
    """

    section_id = _fk(Section, source="section", required=False, allow_null=True)
