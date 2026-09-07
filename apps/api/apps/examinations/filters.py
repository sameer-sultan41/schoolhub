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

from apps.examinations.models import AdmitCard, Exam, ExamSchedule, ExamSubject, GradingScale


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

    class Meta:
        model = AdmitCard
        fields = {"status": ["exact"]}
