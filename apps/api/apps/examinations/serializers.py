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

from apps.examinations import services, uploads
from apps.examinations.models import (
    AdmitCard,
    Exam,
    ExamSchedule,
    ExamSubject,
    GradeBand,
    GradingScale,
    Marks,
    MarksStatus,
    ReportCard,
    Result,
)
from apps.examinations.services import ENTRY_SETTABLE_STATUSES
from apps.school_organization.models import AcademicSession, Class, Section, Subject, Term
from apps.staff_management.models import Staff
from apps.timetable.models import Room

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


class ExamScheduleSerializer(serializers.ModelSerializer):
    """`exam_schedules` — one section's sitting of one paper (§5.2).

    `status` is writable here, unlike on `Exam`: §5.2's transitions are
    `completed` and `cancelled`, neither of which gates anything a client could
    escalate through — a cancelled sitting frees its room, which is the point,
    and marking one complete is an operational note. The exam's own lifecycle is
    the one with an approval gate behind it.
    """

    exam_subject_id = _fk(ExamSubject, source="exam_subject")
    section_id = _fk(Section, source="section")
    room_id = _fk(Room, source="room", required=False, allow_null=True)
    invigilator_staff_id = _fk(Staff, source="invigilator_staff", required=False, allow_null=True)

    class Meta:
        model = ExamSchedule
        fields = (
            "id",
            "exam_subject_id",
            "section_id",
            "exam_date",
            "start_time",
            "end_time",
            "room_id",
            "invigilator_staff_id",
            "status",
            "instructions",
            "created_at",
            "updated_at",
        )
        read_only_fields = READ_ONLY_FIELDS

    def validate(self, attrs: dict) -> dict:
        exam_subject = _value(attrs, self.instance, "exam_subject")
        section = _value(attrs, self.instance, "section")
        start_time = _value(attrs, self.instance, "start_time")
        end_time = _value(attrs, self.instance, "end_time")

        if start_time is not None and end_time is not None and end_time <= start_time:
            raise serializers.ValidationError({"end_time": "A sitting must end after it starts."})

        services.assert_section_studies_the_class(exam_subject=exam_subject, section=section)
        return attrs


class AdmitCardSerializer(serializers.ModelSerializer):
    """`admit_cards` — read-only on the wire (§5.3).

    Every field a client might want to set is set by the module: the number is
    generated so two students can never share one, `file` is written by the
    render job, and `status`/`issued_*` move through `:issue-admit-cards` and
    `:revoke`. There is no create or update endpoint — §16 declares a `GET` and
    two colon-actions, and nothing else.
    """

    exam_id = serializers.UUIDField(read_only=True)
    student_id = serializers.UUIDField(read_only=True)
    file_id = serializers.UUIDField(read_only=True, allow_null=True)

    class Meta:
        model = AdmitCard
        fields = (
            "id",
            "exam_id",
            "student_id",
            "admit_card_no",
            "file_id",
            "status",
            "issued_at",
            "revoked_reason",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields


class AdmitCardRevokeSerializer(serializers.Serializer):
    """The body of `POST /admit-cards/{id}:revoke`.

    The reason is required, not optional: a CHECK constraint enforces it too,
    because a revocation nobody can explain is the one a parent will ask about.
    """

    reason = serializers.CharField(max_length=255)


class MarksSerializer(serializers.ModelSerializer):
    """`marks` — read shape for `GET /marks` (§16).

    Writes go through `:bulk-entry`, not through this serializer: §16 declares a
    `GET` and one colon-action, and a per-row create would bypass the window,
    the lock, the allocation check and the eligible-roll check that the grid
    path applies together.

    `status` is readable but not settable here for the same reason — `locked` is
    `:lock-marks`'s to set, and a client that could write it would close its own
    window.
    """

    exam_subject_id = serializers.UUIDField(read_only=True)
    student_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = Marks
        fields = (
            "id",
            "exam_subject_id",
            "student_id",
            "theory_marks",
            "practical_marks",
            "is_absent",
            "is_exempt",
            "status",
            "remarks",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields


class MarksEntrySerializer(serializers.Serializer):
    """One cell of the grid `:bulk-entry` submits.

    `student_id` is a plain `UUIDField`, not a `PrimaryKeyRelatedField`: the
    service checks eligibility against the exam-subject's own roll and reports
    an ineligible student through `error.meta.rows` with its index, which is
    what a grid needs in order to highlight the cell. A related field would
    turn the first bad id into a flat 400 naming no row.
    """

    student_id = serializers.UUIDField()
    theory_marks = serializers.DecimalField(
        max_digits=6, decimal_places=2, required=False, allow_null=True
    )
    practical_marks = serializers.DecimalField(
        max_digits=6, decimal_places=2, required=False, allow_null=True
    )
    is_absent = serializers.BooleanField(required=False, default=False)
    is_exempt = serializers.BooleanField(required=False, default=False)
    status = serializers.ChoiceField(
        choices=[(value, value) for value in ENTRY_SETTABLE_STATUSES],
        required=False,
        default=MarksStatus.DRAFT,
    )
    remarks = serializers.CharField(
        max_length=255, required=False, allow_null=True, allow_blank=True
    )

    def validate(self, attrs: dict) -> dict:
        if attrs.get("is_absent") and (
            attrs.get("theory_marks") is not None or attrs.get("practical_marks") is not None
        ):
            raise serializers.ValidationError(
                {"is_absent": "An absent student cannot also have a mark."}
            )
        if attrs.get("is_absent") and attrs.get("is_exempt"):
            raise serializers.ValidationError(
                {"is_exempt": ("Absent and exempt are different claims; a row cannot assert both.")}
            )
        return attrs


class BulkMarksEntrySerializer(serializers.Serializer):
    """The body of `POST /marks:bulk-entry` — one exam-subject's whole grid."""

    exam_subject_id = _fk(ExamSubject, source="exam_subject")
    entries = serializers.ListField(child=MarksEntrySerializer(), allow_empty=False)

    def validate_entries(self, value: list[dict]) -> list[dict]:
        seen = set()
        for entry in value:
            if entry["student_id"] in seen:
                raise serializers.ValidationError(
                    f"Student {entry['student_id']} appears twice in this submission."
                )
            seen.add(entry["student_id"])
        return value


class MarksImportRequestSerializer(serializers.Serializer):
    """The body of `POST /marks-imports` — a multipart CSV or .xlsx upload."""

    exam_subject_id = _fk(ExamSubject, source="exam_subject")
    file = serializers.FileField()

    def validate_file(self, value):
        spec = uploads.MARKS_IMPORT
        if value.size > spec.max_size_bytes:
            raise serializers.ValidationError(
                f"This file is larger than the {spec.max_size_bytes // (1024 * 1024)} MB limit."
            )
        if not value.name.lower().endswith((".csv", ".xlsx")):
            raise serializers.ValidationError("Upload a .csv or .xlsx marks sheet.")
        return value


class ResultSerializer(serializers.ModelSerializer):
    """`results` — read-only on the wire (§16 declares a `GET` and no writes).

    Every field here is computed or moved by a permissioned action: the
    aggregates by `:process-results`, `status`/`approved_*` by
    `:approve-results`, `published_at` by `:publish-results`, and `outcome` by
    processing or `:withhold`. A client that could PATCH any of them could skip
    §5.6's gate entirely, which is the whole point of having one.
    """

    exam_id = serializers.UUIDField(read_only=True)
    student_id = serializers.UUIDField(read_only=True)
    section_id = serializers.UUIDField(read_only=True)
    grade = serializers.CharField(source="grade_band.label", read_only=True, default=None)

    class Meta:
        model = Result
        fields = (
            "id",
            "exam_id",
            "student_id",
            "section_id",
            "total_max_marks",
            "total_obtained_marks",
            "percentage",
            "grade",
            "gpa",
            "rank_in_section",
            "rank_in_class",
            "outcome",
            "grace_marks",
            "status",
            "approved_at",
            "published_at",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields


class ReportCardSerializer(serializers.ModelSerializer):
    """`report_cards` — read, plus the two remark fields (§5.7).

    Remarks are the only writable part, and only while the card is a draft:
    §5.7 has a class teacher and a principal write them before generation, and
    editing them on a published card would change a document a parent already
    holds without the version changing.
    """

    exam_id = serializers.UUIDField(read_only=True)
    term_id = serializers.UUIDField(read_only=True)
    student_id = serializers.UUIDField(read_only=True)
    result_id = serializers.UUIDField(read_only=True)
    file_id = serializers.UUIDField(read_only=True, allow_null=True)

    class Meta:
        model = ReportCard
        fields = (
            "id",
            "exam_id",
            "term_id",
            "student_id",
            "result_id",
            "file_id",
            "class_teacher_remarks",
            "principal_remarks",
            "attendance_summary",
            "version",
            "status",
            "published_at",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "exam_id",
            "term_id",
            "student_id",
            "result_id",
            "file_id",
            "attendance_summary",
            "version",
            "status",
            "published_at",
            "created_at",
            "updated_at",
        )


class ResultWithholdSerializer(serializers.Serializer):
    """The body of `POST /results/{id}:withhold` (§5.6).

    A reason is required. Withholding one student's result is a decision
    somebody will be asked about, and "why" is the part that has to survive
    into the audit log — the same argument the admit-card revocation makes.
    """

    reason = serializers.CharField(max_length=255)


class SendResultsBackSerializer(serializers.Serializer):
    """The body of `POST /exams/{id}:send-results-back` (§7.1).

    Not in §16's endpoint list, and built anyway — see the module doc's §20.
    §7.1's flowchart has an explicit "changes requested: unlock and re-enter"
    edge out of the approval gate, and without an endpoint for it a data-entry
    error found at approval has no route back and someone reaches for a
    database edit.
    """

    reason = serializers.CharField(max_length=500)
