"""`CurriculumSerializer` and its clone-request sibling — academics.md §16.

`_fk` and `READ_ONLY_FIELDS` stay in the trimmed root `serializers.py` — every
resource package in this module shares them.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.academics.curriculum import services
from apps.academics.serializers import READ_ONLY_FIELDS, _fk
from apps.school_organization.models import AcademicSession, Campus, Class, ClassSubject, Subject


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
