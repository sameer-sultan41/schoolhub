"""Serializers for the academics module.

Shape follows student_management/serializers.py: FKs are exposed with an `_id`
suffix over the tenant-scoped default manager (so a foreign-tenant id fails to
resolve and yields a 400 rather than leaking), explicit `fields` tuples, and
lifecycle fields read-only because they move only through colon-actions.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.academics import services
from apps.academics.models import (
    PromotionDecision,
    StudentPromotion,
    TeacherSubjectAllocation,
)
from apps.school_organization.models import (
    AcademicSession,
    Campus,
    Class,
    ClassSubject,
    Section,
    Subject,
)
from apps.staff_management.models import Staff

READ_ONLY_FIELDS = ("id", "created_at", "updated_at")


def _fk(model, **kwargs) -> serializers.PrimaryKeyRelatedField:
    return serializers.PrimaryKeyRelatedField(queryset=model.objects, **kwargs)


class CurriculumSerializer(serializers.ModelSerializer):
    """`class_subjects` through the academics contract (§16).

    The model lives in school_organization — see apps/academics/models.py's
    header for why it stays there — but the validations are academics' §11.
    """

    academic_session_id = _fk(AcademicSession, source="academic_session")
    class_id = _fk(Class, source="school_class")
    subject_id = _fk(Subject, source="subject")
    campus_id = _fk(Campus, source="campus", required=False, allow_null=True)

    class Meta:
        model = ClassSubject
        fields = (
            "id",
            "academic_session_id",
            "class_id",
            "subject_id",
            "campus_id",
            "is_elective",
            "elective_group",
            "weekly_periods",
            "syllabus_file_id",
            "term_plans",
            "notes",
            "created_at",
            "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS

    def validate_weekly_periods(self, value: int) -> int:
        """Guards the PATCH path specifically.

        Creation delegates to `map_subject_to_class`, which enforces this — but
        an update never reaches that service, so without this a
        `PATCH {"weekly_periods": 0}` fell through to the
        `class_subjects_weekly_periods_positive` database check and surfaced as a
        409 with no field on it, instead of a field error the form can show.
        """
        if value < 1:
            raise serializers.ValidationError("Weekly period targets must be at least 1.")
        return value

    def validate(self, attrs: dict) -> dict:
        """Term plans, plus the two rules a PATCH would otherwise slip past.

        Session-writable, class/subject active and duplicate rejection all live
        in `school_organization.services.map_subject_to_class`, which the viewset
        delegates creation to — restating them here would mean two places to keep
        in step, and each needs state the payload does not carry.

        `elective_group` is different, for the same reason `weekly_periods` is:
        an **update never reaches that service**. Without this check a
        `PATCH {"is_elective": true}` on a row with no group saved happily, and
        even on create the service's version raises with a bare string, so the
        form got a 422 with `non_field` where it used to get a 400 naming the
        field — behaviour this endpoint had before it moved here from
        school_organization, and there is no reason for the move to have cost it.

        Term plans are academics' own §11 rule and have no counterpart there.
        """
        session = attrs.get("academic_session") or getattr(self.instance, "academic_session", None)
        if session is not None and "term_plans" in attrs:
            services.assert_term_plans_reference_session_terms(
                session=session, term_plans=attrs.get("term_plans")
            )

        is_elective = attrs.get("is_elective")
        if is_elective is None:
            is_elective = getattr(self.instance, "is_elective", False)
        group = attrs.get("elective_group") or getattr(self.instance, "elective_group", None)
        if is_elective and not group:
            raise serializers.ValidationError(
                {"elective_group": "Required for an elective mapping so options can be grouped."}
            )
        return attrs


class CloneCurriculumRequestSerializer(serializers.Serializer):
    source_academic_session_id = _fk(AcademicSession, source="source_session")
    target_academic_session_id = _fk(AcademicSession, source="target_session")


class TeacherAllocationSerializer(serializers.ModelSerializer):
    academic_session_id = _fk(AcademicSession, source="academic_session")
    section_id = _fk(Section, source="section")
    subject_id = _fk(Subject, source="subject")
    staff_id = _fk(Staff, source="staff")

    class Meta:
        model = TeacherSubjectAllocation
        fields = (
            "id",
            "academic_session_id",
            "section_id",
            "subject_id",
            "staff_id",
            "is_primary",
            "weekly_periods",
            "effective_from",
            "effective_to",
            "created_at",
            "updated_at",
        )
        # `effective_to` is set by PATCH, never on create: an allocation that
        # arrives already ended is not a thing, and `create_allocation` would
        # have dropped the value silently.
        read_only_fields = (*READ_ONLY_FIELDS, "effective_to")

    def validate_weekly_periods(self, value: int | None) -> int | None:
        if value is not None and value < 1:
            raise serializers.ValidationError("Weekly periods must be at least 1.")
        return value


class PromotionDecisionSerializer(serializers.ModelSerializer):
    """A single student's row inside a batch.

    Only the fields a reviewer edits are writable; everything that defines which
    batch this is, and where the student came from, is fixed at batch creation.
    """

    student_id = serializers.UUIDField(source="student.id", read_only=True)
    # Denormalised for the review screen: a reviewer scanning a batch needs the
    # student, not a UUID, and the alternative is a lookup per row in the client.
    student_name = serializers.SerializerMethodField()
    admission_number = serializers.CharField(source="student.admission_number", read_only=True)
    to_class_id = _fk(Class, source="to_class", required=False, allow_null=True)
    to_section_id = _fk(Section, source="to_section", required=False, allow_null=True)

    class Meta:
        model = StudentPromotion
        fields = (
            "id",
            "batch_id",
            "student_id",
            "student_name",
            "admission_number",
            "from_enrollment_id",
            "from_academic_session_id",
            "to_academic_session_id",
            "from_class_id",
            "to_class_id",
            "to_section_id",
            "decision",
            "decision_basis",
            "override_reason",
            "remarks",
            "status",
            "approved_by",
            "approved_at",
            "executed_at",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            *READ_ONLY_FIELDS,
            "batch_id",
            "student_id",
            "student_name",
            "admission_number",
            "from_enrollment_id",
            "from_academic_session_id",
            "to_academic_session_id",
            "from_class_id",
            "decision_basis",
            # The batch state machine and its approval trail move only through
            # :submit / :approve / :reject / :execute / :revert.
            "status",
            "approved_by",
            "approved_at",
            "executed_at",
        )

    def get_student_name(self, obj) -> str:
        return f"{obj.student.first_name} {obj.student.last_name}"

    def validate(self, attrs: dict) -> dict:
        decision = attrs.get("decision") or getattr(self.instance, "decision", None)
        to_class = attrs.get("to_class", getattr(self.instance, "to_class", None))

        # Mirrors promotions_target_class_matches_decision so the caller gets a
        # field error rather than a 409 from the database constraint.
        if decision == PromotionDecision.GRADUATED and to_class is not None:
            raise serializers.ValidationError(
                {"to_class_id": "A graduating student has no target class."}
            )
        if decision and decision != PromotionDecision.GRADUATED and to_class is None:
            raise serializers.ValidationError(
                {"to_class_id": "A target class is required unless the student is graduating."}
            )
        return attrs


class PromotionBatchSerializer(serializers.Serializer):
    """A batch, synthesised by aggregating its decision rows.

    There is no `promotion_batches` table — `batch_id` is a grouping column and
    status moves batch-wide, which entities/academics.md settles explicitly. So
    a batch is read-only and derived: its existence, status and shape are
    consequences of its rows rather than a parent record that can drift out of
    sync with them.

    `status` is grouped on rather than picked from a row. If a batch ever
    contained mixed statuses it would surface here as two entries for one
    `batch_id`, which is the honest rendering of a corrupt batch rather than a
    silently chosen winner.
    """

    batch_id = serializers.UUIDField()
    from_academic_session_id = serializers.UUIDField()
    to_academic_session_id = serializers.UUIDField()
    from_class_id = serializers.UUIDField()
    status = serializers.CharField()
    students = serializers.IntegerField()
    started_at = serializers.DateTimeField()


class CreatePromotionBatchSerializer(serializers.Serializer):
    from_academic_session_id = _fk(AcademicSession, source="from_session")
    to_academic_session_id = _fk(AcademicSession, source="to_session")
    class_id = _fk(Class, source="school_class")
