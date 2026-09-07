"""Serializers for the examinations module.

Shape follows timetable/serializers.py: FKs exposed with an `_id` suffix over
the tenant-scoped default manager (so a foreign-tenant id simply fails to
resolve and yields a 400 rather than leaking whether the row exists), explicit
`fields` tuples, and lifecycle fields read-only because they move only through
colon-actions.

`validate_*` delegates to `services.assert_*` rather than restating a rule. The
result-processing job and the marks importer will call the same services, and a
rule implemented twice is a rule that drifts.

**`status` is read-only on every serializer here.** §7.1 makes the exam
lifecycle a state machine whose transitions are permission-gated and audited
(`:approve-results` needs a different key from `:publish-results`), so a client
that could PATCH `status` could skip the approval gate entirely.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from rest_framework import serializers

from apps.examinations import services
from apps.examinations.models import (
    Exam,
    ExamSubject,
    GradeBand,
    GradingScale,
)
from apps.school_organization.models import AcademicSession, Class, Subject, Term

READ_ONLY_FIELDS = ("id", "created_at", "updated_at")


def _fk(model, **kwargs) -> serializers.PrimaryKeyRelatedField:
    """A related field bound to the model's *tenant-scoped* manager.

    `model.objects`, never `.all()`: the manager is what narrows the lookup to
    the caller's tenant, so a smuggled foreign id does not resolve.
    """
    return serializers.PrimaryKeyRelatedField(queryset=model.objects, **kwargs)


def _value(attrs: dict, instance, field: str) -> Any:
    """The submitted value for `field`, or the instance's on a partial update.

    Typed `Any` deliberately. `validated_data` is an untyped dict, and every
    field read through this is either required on create — so DRF has already
    rejected a missing one before `validate` runs — or carried by the instance
    on update. Annotating it `X | None` instead would push a `None` branch into
    every caller for a case that cannot be reached, and the assertions those
    callers make are the readable part.
    """
    if field in attrs:
        return attrs[field]
    return getattr(instance, field, None)


class GradeBandSerializer(serializers.ModelSerializer):
    """`grade_bands` — one band of a grading scale (§5.5).

    The scale is taken from the URL on the nested route, not from the body, so
    `grading_scale_id` is read-only: a band posted to one scale's collection
    naming another scale in its payload is a request with two answers.
    """

    grading_scale_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = GradeBand
        fields = (
            "id",
            "grading_scale_id",
            "label",
            "min_percent",
            "max_percent",
            "grade_point",
            "is_passing",
            "remark",
            "sort_order",
            "created_at",
            "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS

    def validate(self, attrs: dict) -> dict:
        low = _value(attrs, self.instance, "min_percent")
        high = _value(attrs, self.instance, "max_percent")
        if low is not None and high is not None and low >= high:
            raise serializers.ValidationError(
                {"max_percent": "A band's upper bound must be above its lower bound."}
            )
        return attrs


class GradingScaleSerializer(serializers.ModelSerializer):
    """`grading_scales` — a tenant's grading model (§5.5).

    `bands` is nested read-only. A scale is only meaningful with its bands, and
    a client rendering a result needs both in one round trip; writes go through
    the nested `/grade-bands` route so each band gets its own validation and its
    own audit entry.

    `is_default` is read-only here and moves through `:set-default` instead. The
    partial unique index refuses two live defaults, so a plain PATCH setting it
    true would 409 against whichever scale currently holds it — the caller's
    intent is "make this the default", which is two writes, not one.
    """

    bands = GradeBandSerializer(many=True, read_only=True)

    class Meta:
        model = GradingScale
        fields = (
            "id",
            "name",
            "scale_type",
            "gpa_max",
            "is_default",
            "description",
            "bands",
            "created_at",
            "updated_at",
        )
        read_only_fields = (*READ_ONLY_FIELDS, "is_default")

    def validate(self, attrs: dict) -> dict:
        scale_type = _value(attrs, self.instance, "scale_type")
        gpa_max = _value(attrs, self.instance, "gpa_max")
        from apps.examinations.models import GPA_SCALE_TYPES

        if scale_type in GPA_SCALE_TYPES and not gpa_max:
            raise serializers.ValidationError(
                {
                    "gpa_max": (
                        "A GPA or hybrid scale needs a maximum grade point, e.g. 4.00 — "
                        "without one there is nothing to compute a GPA against."
                    )
                }
            )
        return attrs


class ExamSerializer(serializers.ModelSerializer):
    """`exams` — an examination event (§5.1)."""

    academic_session_id = _fk(AcademicSession, source="academic_session")
    term_id = _fk(Term, source="term", required=False, allow_null=True)
    grading_scale_id = _fk(GradingScale, source="grading_scale", required=False)

    class Meta:
        model = Exam
        fields = (
            "id",
            "academic_session_id",
            "term_id",
            "name",
            "exam_type",
            "grading_scale_id",
            "weightage_percent",
            "starts_on",
            "ends_on",
            "status",
            "description",
            "created_at",
            "updated_at",
        )
        read_only_fields = (*READ_ONLY_FIELDS, "status")

    def validate_weightage_percent(self, value: Decimal) -> Decimal:
        if value <= 0 or value > 100:
            raise serializers.ValidationError(
                "Weightage is a percentage contribution, so it must be above 0 and at most 100."
            )
        return value

    def validate(self, attrs: dict) -> dict:
        session = _value(attrs, self.instance, "academic_session")
        term = _value(attrs, self.instance, "term")
        starts_on = _value(attrs, self.instance, "starts_on")
        ends_on = _value(attrs, self.instance, "ends_on")

        if (starts_on is None) != (ends_on is None):
            raise serializers.ValidationError(
                {
                    "ends_on": (
                        "Set both dates or neither. One date alone describes nothing a "
                        "schedule or an admit card can use."
                    )
                }
            )
        if starts_on is not None and ends_on < starts_on:
            raise serializers.ValidationError({"ends_on": "An exam cannot end before it starts."})

        services.assert_session_is_writable(session)
        services.assert_term_belongs_to_session(session=session, term=term)

        scale = _value(attrs, self.instance, "grading_scale")
        if scale is None:
            # §5.1 lets an exam inherit the tenant default rather than naming a
            # scale every time. Resolved here so the refusal below sees the
            # scale the exam would actually grade against.
            scale = services.default_scale()
            if scale is None:
                raise serializers.ValidationError(
                    {
                        "grading_scale_id": (
                            "This tenant has no default grading scale, so an exam must name one."
                        )
                    }
                )
            attrs["grading_scale"] = scale
        services.assert_scale_usable(scale)

        services.assert_exam_dates_in_range(
            starts_on=starts_on, ends_on=ends_on, session=session, term=term
        )

        return attrs


class ExamSubjectSerializer(serializers.ModelSerializer):
    """`exam_subjects` — per-class marks structure for one subject (§5.1)."""

    exam_id = _fk(Exam, source="exam")
    class_id = _fk(Class, source="school_class")
    subject_id = _fk(Subject, source="subject")

    class Meta:
        model = ExamSubject
        fields = (
            "id",
            "exam_id",
            "class_id",
            "subject_id",
            "max_marks",
            "pass_marks",
            "has_practical",
            "practical_max_marks",
            "practical_pass_marks",
            "subject_weightage_percent",
            "marks_entry_opens_at",
            "marks_entry_closes_at",
            "marks_locked_at",
            "created_at",
            "updated_at",
        )
        # `marks_locked_at` moves only through :lock-marks / :unlock-marks
        # (§5.4), which are permission-gated and audited. A client that could
        # PATCH it could reopen a locked register without leaving a trace.
        read_only_fields = (*READ_ONLY_FIELDS, "marks_locked_at")

    def validate(self, attrs: dict) -> dict:
        exam = _value(attrs, self.instance, "exam")
        school_class = _value(attrs, self.instance, "school_class")
        subject = _value(attrs, self.instance, "subject")
        max_marks = _value(attrs, self.instance, "max_marks")
        pass_marks = _value(attrs, self.instance, "pass_marks")

        if max_marks is not None and max_marks <= 0:
            raise serializers.ValidationError({"max_marks": "Nothing can be marked out of zero."})
        if pass_marks is not None and max_marks is not None and pass_marks > max_marks:
            raise serializers.ValidationError(
                {"pass_marks": "Pass marks cannot exceed the subject maximum."}
            )

        services.assert_exam_is_configurable(exam)
        services.assert_subject_in_class_curriculum(
            session=exam.academic_session, school_class=school_class, subject=subject
        )

        services.assert_practical_marks(
            has_practical=_value(attrs, self.instance, "has_practical"),
            practical_max_marks=_value(attrs, self.instance, "practical_max_marks"),
            practical_pass_marks=_value(attrs, self.instance, "practical_pass_marks"),
        )

        window_opens = _value(attrs, self.instance, "marks_entry_opens_at")
        window_closes = _value(attrs, self.instance, "marks_entry_closes_at")
        if window_opens and window_closes and window_closes <= window_opens:
            raise serializers.ValidationError(
                {"marks_entry_closes_at": "The entry window must close after it opens."}
            )

        return attrs
