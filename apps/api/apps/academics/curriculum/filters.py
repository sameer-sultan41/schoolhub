"""Whitelisted filters for `/class-subjects` — academics.md §16 names the fields.

**Every foreign key is an explicit `UUIDFilter`, never a `Meta.fields` entry.**
Declaring `fields = {"academic_session_id": ["exact"]}` against an FK makes
django-filter generate a `ModelChoiceFilter`, and that changes the behaviour in
two ways that both matter:

- it *validates* the id against the related model and answers **400 "Select a
  valid choice"** for anything it cannot resolve, where a filter naming an id
  the caller cannot see should simply match nothing — a filter narrows a list,
  it does not assert that the value exists;
- it costs an extra query per filtered request to do that validation.

`student_management/filters.py` already does it this way; academics was the
outlier, and its own cross-tenant test caught it.
"""

from __future__ import annotations

import django_filters

from apps.school_organization.models import ClassSubject


class CurriculumFilterSet(django_filters.FilterSet):
    academic_session_id = django_filters.UUIDFilter(field_name="academic_session_id")
    # §16 spells this `class_id`; the model field is `school_class` because
    # `class` is a Python keyword.
    class_id = django_filters.UUIDFilter(field_name="school_class_id")
    subject_id = django_filters.UUIDFilter(field_name="subject_id")
    campus_id = django_filters.UUIDFilter(field_name="campus_id")

    class Meta:
        model = ClassSubject
        fields = {
            "is_elective": ["exact"],
            "elective_group": ["exact"],
        }
