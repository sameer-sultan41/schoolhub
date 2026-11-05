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
from collections.abc import Iterable
from typing import Any

from django.db import models
from rest_framework import serializers

from apps.school_organization.models import AcademicSession, Campus, Class, House, Section
from apps.student_management import services, uploads
from apps.student_management.models import (
    EmergencyContact,
    EnrollmentStatus,
    Guardian,
    Student,
    StudentDocument,
    StudentEnrollment,
    StudentGuardian,
    StudentTransfer,
    TransferStatus,
)
from apps.student_management.portal_accounts.serializers import PortalStatusField
from core.files.models import File
from core.files.serializers import SignedFileURLField
from core.files.services import assert_file_usable
from core.rbac.models import RecordScope
from core.rbac.permissions import scope_queryset, scopes_for

READ_ONLY_FIELDS = ("id", "created_at", "updated_at")

# `StudentViewSet`'s read and update keys, spelled once: the viewset declares them and
# medical-notes visibility reads them.
STUDENT_VIEW = "students.student.view"
STUDENT_UPDATE = "students.student.update"

# The serializer context key that carries one response's `student id -> may see
# medical_notes` map.
MEDICAL_NOTES_CONTEXT_KEY = "students_medical_notes_visible"


def _fk(model, **kwargs) -> serializers.PrimaryKeyRelatedField:
    """A tenant-scoped related field — see school_organization/
    serializer_helpers.py's identical ``fk()`` helper for why the *manager*,
    not ``manager.all()``, is passed.
    """
    return serializers.PrimaryKeyRelatedField(queryset=model.objects, **kwargs)


class StudentListSerializer(serializers.ListSerializer):
    """Resolves every row's medical-notes visibility in one pass before the rows render."""

    def to_representation(self, data):
        rows = list(data.all() if isinstance(data, models.manager.BaseManager) else data)
        user = _request_user(self.context)
        if user is not None:
            _load_medical_notes_visibility(self.context, user, (row.pk for row in rows))
        return super().to_representation(rows)


class StudentSerializer(serializers.ModelSerializer):
    campus_id = _fk(Campus, source="campus")
    house_id = _fk(House, source="house", required=False, allow_null=True)
    photo_file_id = _fk(File, source="photo_file", required=False, allow_null=True)
    # The photo above as a display link. `expected_purpose` gates it on the attached file's
    # own purpose, not just `SignedFileURLField`'s usual status/deleted_at check —
    # `validate_photo_file_id` only stops a NEW mismatched file from being attached; it does
    # nothing for a photo_file that was already attached before that guard existed. Reuses
    # get_queryset's select_related("photo_file"), so this costs no query per row either.
    photo_url = SignedFileURLField(source="photo_file", expected_purpose=uploads.STUDENT_PHOTO.key)
    # Explicitly optional: the model column has no `blank=True`, so DRF's
    # ModelSerializer would otherwise auto-derive it as *required* — but the
    # service always generates it server-side on create (views.py's
    # perform_create never reads it out of validated_data) and rejects a
    # changed value on update via validate_admission_number below. A
    # client-supplied value on create is simply ignored, not an error.
    admission_number = serializers.CharField(max_length=32, required=False)
    # The roll renders a campus and a house, not two UUIDs, and it was the only
    # consumer of these relations — so the names come down with the row rather than
    # costing the dashboard a second request per lookup table. Read through the FK
    # rather than off the list queryset's `campus_name`/`house_name` annotations:
    # those exist only on the list (they are what `?ordering=` sorts on), and a
    # serializer that read them would raise on retrieve and create. `get_queryset`
    # already applies select_related to both, so the list pays no extra query.
    campus_name = serializers.CharField(source="campus.name", read_only=True)
    # Nullable: a student need not be in a house.
    house_name = serializers.CharField(source="house.name", read_only=True, allow_null=True)
    portal_status = PortalStatusField()

    class Meta:
        model = Student
        fields = (
            "id",
            "admission_number",
            "user_id",
            "portal_status",
            "first_name",
            "last_name",
            "preferred_name",
            "date_of_birth",
            "gender",
            "photo_file_id",
            "photo_url",
            "campus_id",
            "campus_name",
            "house_id",
            "house_name",
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
        list_serializer_class = StudentListSerializer

    def validate_admission_number(self, value: str) -> str:
        if self.instance is not None:
            services.assert_admission_number_immutable(instance=self.instance, new_value=value)
        return value

    def validate_photo_file_id(self, value: File | None) -> File | None:
        # `_fk()` only proves the file exists in this tenant. Without this, a PATCH could
        # point the photo at any ready file and photo_url would sign it for every viewer.
        # The current photo passes unchecked: edits re-send it unchanged.
        if value is not None and value.pk != getattr(self.instance, "photo_file_id", None):
            assert_file_usable(file=value, purpose=uploads.STUDENT_PHOTO.key)
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

        Field-level, not row-level: a caller whose `students.student.update` scope
        reaches this row, or a class teacher whose `students.student.view` scope is
        `assigned` and who teaches this student, may see it
        (`_load_medical_notes_visibility`). Anyone else — including a student/guardian
        viewing under `own` scope — gets the field omitted entirely rather than
        nulled, so its *absence* is itself the signal that the field exists but was
        withheld (see student-profile.tsx's client-side handling of this in the
        dashboard PR).
        """
        data = super().to_representation(instance)
        user = _request_user(self.context)
        if user is None or not _may_see_medical_notes(self.context, user, instance.pk):
            data.pop("medical_notes", None)
        return data


def _request_user(context: dict):
    request = context.get("request")
    return getattr(request, "user", None) if request else None


def _may_see_medical_notes(context: dict, user, student_id: uuid.UUID) -> bool:
    return _load_medical_notes_visibility(context, user, [student_id])[student_id]


def _load_medical_notes_visibility(
    context: dict, user, student_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, bool]:
    """Whether ``user`` may see each student's medical notes, kept in the root's context.

    Each reach is read through the key it belongs to (auth-and-rbac.md §2.3), never
    through another role's scope:

    - `students.student.update` shows the notes of the rows inside *that key's*
      scope (`scope_queryset`), not of every row some other role lets them read;
    - an `assigned` scope on `students.student.view` (a class teacher) shows the
      notes of the students they teach (`Student.filter_assigned_to_user`).

    Ids already resolved are not asked again, so a list costs at most one query per
    reach over the whole page, and a row of it none.
    """
    visible: dict[uuid.UUID, bool] = context.setdefault(MEDICAL_NOTES_CONTEXT_KEY, {})
    missing = {pk for pk in student_ids if pk not in visible}
    if not missing:
        return visible
    allowed = set(
        scope_queryset(
            Student.objects.filter(pk__in=missing),
            user,
            permission=STUDENT_UPDATE,
            **services.STUDENT_SCOPE,
        ).values_list("pk", flat=True)
    )
    rest = missing - allowed
    if rest and RecordScope.ASSIGNED in scopes_for(user, STUDENT_VIEW):
        allowed |= set(
            Student.filter_assigned_to_user(Student.objects.filter(pk__in=rest), user).values_list(
                "pk", flat=True
            )
        )
    visible.update({pk: pk in allowed for pk in missing})
    return visible


class GuardianSerializer(serializers.ModelSerializer):
    photo_file_id = _fk(File, source="photo_file", required=False, allow_null=True)
    # Same purpose-gated pattern as StudentSerializer.photo_url — see that field's own comment.
    photo_url = SignedFileURLField(source="photo_file", expected_purpose=uploads.GUARDIAN_PHOTO.key)
    portal_status = PortalStatusField()

    class Meta:
        model = Guardian
        fields = (
            "id",
            "user_id",
            "portal_status",
            "first_name",
            "last_name",
            "phone",
            "alt_phone",
            "email",
            "occupation",
            "employer",
            "national_id",
            "photo_file_id",
            "photo_url",
            "address",
            "custom_fields",
            "created_at",
            "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS

    def validate_photo_file_id(self, value: File | None) -> File | None:
        # Mirrors Student.photo_file/StudentDocument.file: a resolved File still
        # needs its purpose and upload-confirmed status checked — the tenant-scoped
        # `_fk()` field only proves the id exists and belongs to this tenant. The
        # current photo passes unchecked (same as StudentSerializer): an edit that
        # re-sends it unchanged must not be blocked by a purpose check that only
        # matters for a *new* file.
        if value is not None and value.pk != getattr(self.instance, "photo_file_id", None):
            assert_file_usable(file=value, purpose=uploads.GUARDIAN_PHOTO.key)
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


class EnrollmentHistoryEventSerializer(serializers.Serializer):
    """Documents one ``build_history`` enrollment-event dict exactly — the

    fields here are not derived from a model, they mirror that function's own
    dict construction field-for-field so the two can never silently drift.
    """

    type = serializers.ChoiceField(choices=["enrollment"])
    id = serializers.UUIDField()
    date = serializers.DateField()
    status = serializers.ChoiceField(choices=EnrollmentStatus.choices)
    academic_session_id = serializers.UUIDField()
    academic_session_name = serializers.CharField()
    class_id = serializers.UUIDField()
    class_name = serializers.CharField()
    section_id = serializers.UUIDField()
    section_name = serializers.CharField()
    roll_number = serializers.CharField(allow_null=True)


class TransferHistoryEventSerializer(serializers.Serializer):
    """Documents one ``build_history`` transfer-event dict exactly — see

    EnrollmentHistoryEventSerializer's docstring for why this mirrors the
    function's dict construction rather than a model.
    """

    type = serializers.ChoiceField(choices=["transfer"])
    id = serializers.UUIDField()
    date = serializers.DateField()
    status = serializers.ChoiceField(choices=TransferStatus.choices)
    transfer_type = serializers.CharField()
    from_campus_id = serializers.UUIDField(allow_null=True)
    from_campus_name = serializers.CharField(allow_null=True)
    to_campus_id = serializers.UUIDField(allow_null=True)
    to_campus_name = serializers.CharField(allow_null=True)
    external_school_name = serializers.CharField(allow_null=True)
    reason = serializers.CharField()


class TransferCompleteRequestSerializer(serializers.Serializer):
    """`section_id` is required only for an inter-campus transfer whose student still has

    an active enrollment to reassign — see services.complete_transfer, which raises a
    field-specific error when it is missing in that case, rather than this serializer
    guessing at a conditional-required rule.
    """

    section_id = _fk(Section, source="section", required=False, allow_null=True)


class StudentImportRequestSerializer(serializers.Serializer):
    """`POST /student-imports` (multipart).

    The file goes straight into the background job's own payload rather than
    through core.files' two-step presigned flow — that flow exists for large
    binary media served back out to users later (photos, documents); an
    import file is read once, synchronously, into the job and never needs a
    signed download URL of its own.
    """

    file = serializers.FileField()


class IdCardGenerateRequestSerializer(serializers.Serializer):
    student_ids = serializers.ListField(child=serializers.UUIDField(), min_length=1)
