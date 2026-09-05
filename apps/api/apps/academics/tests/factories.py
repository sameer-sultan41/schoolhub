"""Factories for the academics tests.

See school_organization/tests/factories.py's module docstring for why every
factory writes through the tenant-scoped default manager inside
``tenant_context(...)``.
"""

from __future__ import annotations

import uuid

import factory

from apps.academics.models import PromotionDecision, StudentPromotion, TeacherSubjectAllocation
from apps.school_organization.models import ClassSubject
from apps.school_organization.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    ClassSubjectFactory,
    DepartmentFactory,
    SectionFactory,
    SubjectFactory,
    TenantFactory,
    TermFactory,
    UserFactory,
    authenticate,
    grant,
)
from apps.staff_management.tests.factories import StaffFactory
from core.tenancy.models import FeatureFlag, TenantFeatureOverride


class TeacherAllocationFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = TeacherSubjectAllocation

    is_primary = True
    # No SubFactory defaults: session/section/subject/staff must all belong to
    # the same tenant and satisfy section -> class -> curriculum, so callers wire
    # them explicitly — the convention StudentEnrollmentFactory already sets.


class StudentPromotionFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = StudentPromotion

    batch_id = factory.LazyFunction(uuid.uuid4)
    decision = PromotionDecision.PROMOTED


def enable_feature(tenant, key: str) -> None:
    """Force ``key`` on for ``tenant``, regardless of its coded default.

    `update_or_create`, not `get_or_create`: an existing `enabled=False` row
    would otherwise stick and the test would fail on a disabled module rather
    than on what it meant to assert.
    """
    from core.tenancy.context import tenant_context

    flag = FeatureFlag.objects.get(key=key)
    with tenant_context(tenant.id):
        TenantFeatureOverride.objects.update_or_create(
            tenant=tenant,
            feature_flag=flag,
            defaults={"enabled": True, "reason": "academics test fixture"},
        )


__all__ = [
    "AcademicSessionFactory",
    "CampusFactory",
    "ClassFactory",
    "ClassSubject",
    "ClassSubjectFactory",
    "DepartmentFactory",
    "SectionFactory",
    "StaffFactory",
    "StudentPromotionFactory",
    "SubjectFactory",
    "TeacherAllocationFactory",
    "TenantFactory",
    "TermFactory",
    "UserFactory",
    "authenticate",
    "enable_feature",
    "grant",
]
