"""Typed rows for `GET /reports/exam-summary`, one serializer per `kind` (ADR-0022).

Separate from `serializers.py`, which is already past its size budget: these
describe `reports.py`'s rows and nothing else reads them.
"""

from __future__ import annotations

from drf_spectacular.utils import PolymorphicProxySerializer
from rest_framework import serializers

from apps.examinations.models import QuestionDifficulty, ResultOutcome, ResultStatus

# Each mirrors its `reports` function's row field for field. `kind` is the
# discriminator; the view adds it and dispatches through `REPORT_ROW_SERIALIZERS`.
# Decimals stay JSON numbers, as the inline report has always sent them (a raw
# Decimal encodes as a float).


def _report_kind(kind: str) -> serializers.ChoiceField:
    """The discriminator: a one-value choice, so the schema names each row type's `kind`."""
    return serializers.ChoiceField(choices=[(kind, kind)], read_only=True)


def _number(**kwargs) -> serializers.DecimalField:
    """A 2-place figure. Averages arrive already rounded (`reports.AVERAGE_DECIMAL_PLACES`),
    so the field's own quantize changes nothing and the inline rows match the exports."""
    return serializers.DecimalField(
        max_digits=12, decimal_places=2, coerce_to_string=False, read_only=True, **kwargs
    )


def _rate() -> serializers.DecimalField:
    """A percentage to one decimal place, 0 when nothing was counted (`reports._rate`)."""
    return serializers.DecimalField(
        max_digits=4, decimal_places=1, coerce_to_string=False, read_only=True
    )


class ResultRegisterReportRowSerializer(serializers.Serializer):
    """`reports.result_register`: one student's result, in rank order (unranked last)."""

    kind = _report_kind("result-register")
    id = serializers.UUIDField(read_only=True)
    student_id = serializers.UUIDField(read_only=True)
    first_name = serializers.CharField(read_only=True)
    last_name = serializers.CharField(read_only=True)
    admission_number = serializers.CharField(read_only=True)
    section_name = serializers.CharField(read_only=True)
    percentage = _number()
    total_obtained_marks = _number()
    total_max_marks = _number()
    grade = serializers.CharField(read_only=True, allow_null=True)
    gpa = _number(allow_null=True)
    rank_in_section = serializers.IntegerField(read_only=True, allow_null=True)
    rank_in_class = serializers.IntegerField(read_only=True, allow_null=True)
    outcome = serializers.ChoiceField(choices=ResultOutcome.choices, read_only=True)
    status = serializers.ChoiceField(choices=ResultStatus.choices, read_only=True)


class PassFailAnalysisReportRowSerializer(serializers.Serializer):
    """`reports.pass_fail_analysis`: one section's counts; the rate is passed over sat."""

    kind = _report_kind("pass-fail-analysis")
    section_id = serializers.UUIDField(read_only=True)
    section_name = serializers.CharField(read_only=True)
    students = serializers.IntegerField(read_only=True)
    sat = serializers.IntegerField(read_only=True)
    passed = serializers.IntegerField(read_only=True)
    failed = serializers.IntegerField(read_only=True)
    absent = serializers.IntegerField(read_only=True)
    withheld = serializers.IntegerField(read_only=True)
    average_percentage = _number(allow_null=True)
    highest_percentage = _number(allow_null=True)
    lowest_percentage = _number(allow_null=True)
    pass_rate = _rate()


class SubjectPerformanceReportRowSerializer(serializers.Serializer):
    """`reports.subject_performance`: one exam-subject's theory marks, absent/exempt left out."""

    kind = _report_kind("subject-performance")
    exam_subject_id = serializers.UUIDField(read_only=True)
    subject_name = serializers.CharField(read_only=True)
    class_name = serializers.CharField(read_only=True)
    max_marks = _number()
    pass_marks = _number()
    students = serializers.IntegerField(read_only=True)
    average_marks = _number(allow_null=True)
    highest_marks = _number(allow_null=True)
    lowest_marks = _number(allow_null=True)
    passed = serializers.IntegerField(read_only=True)
    pass_rate = _rate()


class MarksEntryStatusReportRowSerializer(serializers.Serializer):
    """`reports.marks_entry_status`: one exam-subject's entered rows by status."""

    kind = _report_kind("marks-entry-status")
    exam_subject_id = serializers.UUIDField(read_only=True)
    subject_name = serializers.CharField(read_only=True)
    class_name = serializers.CharField(read_only=True)
    locked_at = serializers.DateTimeField(read_only=True, allow_null=True)
    entered = serializers.IntegerField(read_only=True)
    draft = serializers.IntegerField(read_only=True)
    submitted = serializers.IntegerField(read_only=True)
    locked = serializers.IntegerField(read_only=True)
    absent = serializers.IntegerField(read_only=True)
    exempt = serializers.IntegerField(read_only=True)


class GradeDistributionReportRowSerializer(serializers.Serializer):
    """`reports.grade_distribution`: one band's count; band fields are null when ungraded."""

    kind = _report_kind("grade-distribution")
    grade_band_id = serializers.UUIDField(read_only=True, allow_null=True)
    grade = serializers.CharField(read_only=True, allow_null=True)
    min_percent = _number(allow_null=True)
    max_percent = _number(allow_null=True)
    is_passing = serializers.BooleanField(read_only=True, allow_null=True)
    students = serializers.IntegerField(read_only=True)


class QuestionBankUsageReportRowSerializer(serializers.Serializer):
    """`reports.question_bank_usage`: one bank's questions at one difficulty."""

    kind = _report_kind("question-bank-usage")
    question_bank_id = serializers.UUIDField(read_only=True)
    bank_name = serializers.CharField(read_only=True)
    subject_name = serializers.CharField(read_only=True)
    difficulty = serializers.ChoiceField(choices=QuestionDifficulty.choices, read_only=True)
    questions = serializers.IntegerField(read_only=True)
    approved = serializers.IntegerField(read_only=True)
    total_uses = serializers.IntegerField(
        read_only=True, help_text="Questions used in at least one paper."
    )
    average_uses = serializers.FloatField(read_only=True, allow_null=True)


# The runtime dispatch, by `kind`; `PolymorphicProxySerializer` only documents it (ADR-0022).
REPORT_ROW_SERIALIZERS: dict[str, type[serializers.Serializer]] = {
    "result-register": ResultRegisterReportRowSerializer,
    "pass-fail-analysis": PassFailAnalysisReportRowSerializer,
    "subject-performance": SubjectPerformanceReportRowSerializer,
    "marks-entry-status": MarksEntryStatusReportRowSerializer,
    "grade-distribution": GradeDistributionReportRowSerializer,
    "question-bank-usage": QuestionBankUsageReportRowSerializer,
}


# Documents the rows in the schema only; it serializes nothing (ADR-0022).
EXAM_REPORT_ROWS = PolymorphicProxySerializer(
    component_name="ExamReportRow",
    serializers=REPORT_ROW_SERIALIZERS,
    resource_type_field_name="kind",
    many=True,
)
