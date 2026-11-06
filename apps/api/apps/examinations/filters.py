"""Query filters for the examinations module.

**Every FK is an explicit `UUIDFilter`, never a `Meta.fields` entry.** A
`ModelChoiceFilter` — which is what `Meta.fields` generates for a relation —
validates the supplied id against a queryset built at import time, with no
tenant bound. Under RLS that queryset is empty, so the filter answers 400 for
the caller's *own* ids. `timetable/filters.py` carries the same reasoning and
the same shape; this is not a stylistic preference.

Scalar and date lookups go through `Meta.fields` because they need no queryset
to validate against.
"""

from __future__ import annotations

import django_filters
from django.db.models import F, Q

from apps.examinations.models import (
    AdmitCard,
    Exam,
    ExamSchedule,
    ExamStatus,
    ExamSubject,
    GradingScale,
    Marks,
    Question,
    QuestionBank,
    ReportCard,
    Result,
)


class GradingScaleFilterSet(django_filters.FilterSet):
    class Meta:
        model = GradingScale
        fields = {"scale_type": ["exact"], "is_default": ["exact"]}


class ExamFilterSet(django_filters.FilterSet):
    academic_session_id = django_filters.UUIDFilter(field_name="academic_session_id")
    term_id = django_filters.UUIDFilter(field_name="term_id")
    grading_scale_id = django_filters.UUIDFilter(field_name="grading_scale_id")

    class Meta:
        model = Exam
        fields = {
            "status": ["exact"],
            "exam_type": ["exact"],
            "starts_on": ["exact", "gte", "lte"],
            "ends_on": ["exact", "gte", "lte"],
        }


class ExamSubjectFilterSet(django_filters.FilterSet):
    exam_id = django_filters.UUIDFilter(field_name="exam_id")
    class_id = django_filters.UUIDFilter(field_name="school_class_id")
    subject_id = django_filters.UUIDFilter(field_name="subject_id")
    # The operational question §6's missing-entries dashboard asks: which
    # exam-subjects are still open? Expressed as a boolean over a nullable
    # timestamp, because "is it locked" is what a caller means and
    # `marks_locked_at__isnull=false` is what they would otherwise have to send.
    is_locked = django_filters.BooleanFilter(
        field_name="marks_locked_at", lookup_expr="isnull", exclude=True
    )

    class Meta:
        model = ExamSubject
        fields = {"has_practical": ["exact"]}


class ExamScheduleFilterSet(django_filters.FilterSet):
    exam_subject_id = django_filters.UUIDFilter(field_name="exam_subject_id")
    section_id = django_filters.UUIDFilter(field_name="section_id")
    room_id = django_filters.UUIDFilter(field_name="room_id")
    invigilator_staff_id = django_filters.UUIDFilter(field_name="invigilator_staff_id")
    # Not on the model: a sitting names its exam only through its exam-subject,
    # and "show me this exam's timetable" is the question every caller actually
    # asks. Spelling it out here beats making a client send
    # `exam_subject__exam_id`, which is a join path rather than a contract.
    exam_id = django_filters.UUIDFilter(field_name="exam_subject__exam_id")

    class Meta:
        model = ExamSchedule
        fields = {"exam_date": ["exact", "gte", "lte"], "status": ["exact"]}


class AdmitCardFilterSet(django_filters.FilterSet):
    exam_id = django_filters.UUIDFilter(field_name="exam_id")
    student_id = django_filters.UUIDFilter(field_name="student_id")
    # A card names no section: the student's is on their enrollment. The one
    # that counts is their enrollment in the exam's own session, in any status
    # (a closed session's rows are promoted/graduated), the same row
    # `AdmitCardSerializer.section_id` reports, so filtering by a section
    # returns exactly the cards that render with it.
    section_id = django_filters.UUIDFilter(method="filter_section_id")
    # Cards for exams that have not ended by the school's today (the portal's list).
    current = django_filters.BooleanFilter(method="filter_current")

    class Meta:
        model = AdmitCard
        fields = {"status": ["exact"]}

    def filter_current(self, queryset, name, value):
        # An undated exam has not ended. `false` is no filter rather than "past only".
        if not value:
            return queryset
        today = self.request.tenant.local_date()
        # A deleted or archived exam is never current, whatever its dates.
        live = queryset.filter(exam__deleted_at__isnull=True).exclude(
            exam__status=ExamStatus.ARCHIVED
        )
        return live.filter(Q(exam__ends_on__isnull=True) | Q(exam__ends_on__gte=today))

    def filter_section_id(self, queryset, name, value):
        # One `.filter()` call, so every condition lands on the same enrollment
        # join. That join matches at most one row per card — enrollments are
        # unique per student per session — so no card is repeated.
        return queryset.filter(
            student__enrollments__section_id=value,
            student__enrollments__deleted_at__isnull=True,
            student__enrollments__academic_session_id=F("exam__academic_session_id"),
        )


class MarksFilterSet(django_filters.FilterSet):
    exam_subject_id = django_filters.UUIDFilter(field_name="exam_subject_id")
    student_id = django_filters.UUIDFilter(field_name="student_id")
    # A grid is loaded per exam-subject, but "everything outstanding for this
    # exam" is the chase list §6 describes, and it crosses subjects.
    exam_id = django_filters.UUIDFilter(field_name="exam_subject__exam_id")
    section_id = django_filters.UUIDFilter(method="filter_section")

    class Meta:
        model = Marks
        fields = {"status": ["exact"], "is_absent": ["exact"], "is_exempt": ["exact"]}

    def filter_section(self, queryset, name, value):
        # The student's enrollment in the exam's own session, in any status (L50):
        # one row per (student, session), so a promoted student's marks keep their section.
        return queryset.filter(
            student__enrollments__section_id=value,
            student__enrollments__academic_session_id=F("exam_subject__exam__academic_session_id"),
            student__enrollments__deleted_at__isnull=True,
        )


class ResultFilterSet(django_filters.FilterSet):
    exam_id = django_filters.UUIDFilter(field_name="exam_id")
    student_id = django_filters.UUIDFilter(field_name="student_id")
    section_id = django_filters.UUIDFilter(field_name="section_id")

    class Meta:
        model = Result
        fields = {"status": ["exact"], "outcome": ["exact"]}


class ReportCardFilterSet(django_filters.FilterSet):
    exam_id = django_filters.UUIDFilter(field_name="exam_id")
    term_id = django_filters.UUIDFilter(field_name="term_id")
    student_id = django_filters.UUIDFilter(field_name="student_id")
    # The section on the card's result (recorded at processing time), the one
    # `ReportCardSerializer.section_id` reports; a term card has none.
    section_id = django_filters.UUIDFilter(field_name="result__section_id")

    class Meta:
        model = ReportCard
        fields = {"status": ["exact"]}


class QuestionBankFilterSet(django_filters.FilterSet):
    subject_id = django_filters.UUIDFilter(field_name="subject_id")
    class_id = django_filters.UUIDFilter(field_name="school_class_id")

    class Meta:
        model = QuestionBank
        fields = {"status": ["exact"]}


class QuestionFilterSet(django_filters.FilterSet):
    # The blueprint's own axes, so a teacher can see the pool a section will
    # draw from before assembling anything.
    topic = django_filters.CharFilter(field_name="topic", lookup_expr="iexact")

    class Meta:
        model = Question
        fields = {
            "difficulty": ["exact"],
            "question_type": ["exact"],
            "source": ["exact"],
            "is_approved": ["exact"],
        }
