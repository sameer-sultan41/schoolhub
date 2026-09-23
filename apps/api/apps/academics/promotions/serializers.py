"""Serializers for `/student-promotions` — academics.md §16.

Shape follows the module root's `serializers.py`: FKs are exposed with an
`_id` suffix over the tenant-scoped default manager (so a foreign-tenant id
fails to resolve and yields a 400 rather than leaking), explicit `fields`
tuples, and lifecycle fields read-only because they move only through
colon-actions. `_fk` and `READ_ONLY_FIELDS` are shared by every serializer in
the module and stay at the trimmed root.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.academics.models import PromotionDecision, StudentPromotion
from apps.academics.promotions import services
from apps.academics.serializers import READ_ONLY_FIELDS, _fk
from apps.school_organization.models import AcademicSession, Class, Section


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

        # §6's retention rule. Delegated rather than restated for the same reason
        # `CurriculumSerializer` delegates the term-plan check: `_execute_one` is
        # the gate that actually cannot be bypassed, and one of the two has to be
        # the copy the other reads. It raises against `to_class_id`, so the
        # decision editor still lands it on the target-class picker.
        services.assert_retention_keeps_the_class(
            decision=decision,
            from_class_id=getattr(self.instance, "from_class_id", None),
            to_class_id=to_class.pk if to_class is not None else None,
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
