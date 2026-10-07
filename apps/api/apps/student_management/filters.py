"""Filter set for the student-management module.

Every filterable field is listed explicitly — see school_organization/houses/
filters.py for why. Filter names match the module doc §16.
"""

from __future__ import annotations

import django_filters
from django.db.models import Exists, OuterRef

from apps.student_management.models import Student, StudentEnrollment, StudentTransfer


class StudentFilterSet(django_filters.FilterSet):
    campus_id = django_filters.UUIDFilter(field_name="campus_id")
    house_id = django_filters.UUIDFilter(field_name="house_id")
    # Enrollment attributes. These three are declared as no-ops (not joined
    # independently) so django-filter still validates them as UUIDs and still
    # documents them as query params; the real filtering happens once, below,
    # in filter_queryset. Three independent `enrollments__...` joins would let
    # a student match via two different enrollment rows (e.g. a session filter
    # satisfied by last year's enrollment and a class filter satisfied by this
    # year's) instead of one row satisfying every supplied condition together.
    academic_session_id = django_filters.UUIDFilter(method="noop")
    class_id = django_filters.UUIDFilter(method="noop")
    section_id = django_filters.UUIDFilter(method="noop")

    class Meta:
        model = Student
        fields = [
            "campus_id",
            "house_id",
            "status",
            "academic_session_id",
            "class_id",
            "section_id",
        ]

    def noop(self, queryset, name, value):
        return queryset

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        cleaned = self.form.cleaned_data
        conditions = {}
        if cleaned.get("academic_session_id"):
            conditions["academic_session_id"] = cleaned["academic_session_id"]
        if cleaned.get("class_id"):
            conditions["school_class_id"] = cleaned["class_id"]
        if cleaned.get("section_id"):
            conditions["section_id"] = cleaned["section_id"]
        if not conditions:
            return queryset
        return queryset.filter(
            Exists(
                StudentEnrollment.objects.alive().filter(student_id=OuterRef("pk"), **conditions)
            )
        )


class StudentTransferFilterSet(django_filters.FilterSet):
    student_id = django_filters.UUIDFilter(field_name="student_id")

    class Meta:
        model = StudentTransfer
        fields = ["student_id"]
