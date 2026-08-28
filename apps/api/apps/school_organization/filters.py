"""Filter sets for the school-organization module.

Every filterable field is listed explicitly rather than generated from the model:
an implicit ``fields = "__all__"`` turns any column added later into a public query
surface — including ones that leak information or index badly.

Filter names match the module doc §16 (``campus_id``, ``class_id``,
``academic_session_id``, ``is_active``); free-text ``search`` is handled by DRF's
SearchFilter via each viewset's ``search_fields``.
"""

from __future__ import annotations

import django_filters

from apps.school_organization.models import (
    AcademicSession,
    Campus,
    Class,
    ClassSubject,
    Department,
    House,
    Section,
    Subject,
    Term,
)


class CampusFilterSet(django_filters.FilterSet):
    class Meta:
        model = Campus
        fields = ["is_active", "is_primary"]


class DepartmentFilterSet(django_filters.FilterSet):
    campus_id = django_filters.UUIDFilter(field_name="campus_id")

    class Meta:
        model = Department
        fields = ["campus_id", "department_type", "is_active"]


class AcademicSessionFilterSet(django_filters.FilterSet):
    class Meta:
        model = AcademicSession
        fields = ["status", "is_current"]


class TermFilterSet(django_filters.FilterSet):
    academic_session_id = django_filters.UUIDFilter(field_name="academic_session_id")

    class Meta:
        model = Term
        fields = ["academic_session_id"]


class ClassFilterSet(django_filters.FilterSet):
    class Meta:
        model = Class
        fields = ["is_active", "level"]


class SectionFilterSet(django_filters.FilterSet):
    campus_id = django_filters.UUIDFilter(field_name="campus_id")
    class_id = django_filters.UUIDFilter(field_name="school_class_id")

    class Meta:
        model = Section
        fields = ["campus_id", "class_id", "is_active"]


class SubjectFilterSet(django_filters.FilterSet):
    department_id = django_filters.UUIDFilter(field_name="department_id")

    class Meta:
        model = Subject
        fields = ["department_id", "subject_type", "is_active"]


class ClassSubjectFilterSet(django_filters.FilterSet):
    academic_session_id = django_filters.UUIDFilter(field_name="academic_session_id")
    class_id = django_filters.UUIDFilter(field_name="school_class_id")
    subject_id = django_filters.UUIDFilter(field_name="subject_id")
    campus_id = django_filters.UUIDFilter(field_name="campus_id")

    class Meta:
        model = ClassSubject
        fields = [
            "academic_session_id",
            "class_id",
            "subject_id",
            "campus_id",
            "is_elective",
            "elective_group",
        ]


class HouseFilterSet(django_filters.FilterSet):
    class Meta:
        model = House
        fields = ["is_active"]
