"""Factories for the staff-management tests.

See school_organization/tests/factories.py's module docstring for why every
factory writes through the tenant-scoped default manager inside
``tenant_context(...)``.
"""

from __future__ import annotations

import datetime

import factory

from apps.school_organization.tests.factories import CampusFactory, DepartmentFactory
from apps.staff_management.models import (
    Designation,
    EmploymentType,
    Gender,
    Staff,
    StaffDocument,
    StaffQualification,
    StaffType,
)
from core.files.tests.factories import FileFactory

DEFAULT_JOINING_DATE = datetime.date(2026, 4, 1)


class DesignationFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Designation

    name = factory.Sequence(lambda n: f"Designation {n}")
    code = factory.Sequence(lambda n: f"DSG{n:03d}")
    is_active = True


class StaffFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Staff

    employee_number = factory.Sequence(lambda n: f"TEST-{n:04d}")
    first_name = factory.Sequence(lambda n: f"Staff{n}")
    last_name = "Test"
    gender = Gender.UNSPECIFIED
    staff_type = StaffType.TEACHING
    employment_type = EmploymentType.FULL_TIME
    joining_date = DEFAULT_JOINING_DATE
    phone = factory.Sequence(lambda n: f"+92300{n:07d}")
    # No SubFactory default for `campus`: it must belong to the same tenant as
    # the staff member, so callers pass an already-created, correctly-tenanted
    # Campus explicitly — matching student_management's StudentFactory.


class StaffQualificationFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = StaffQualification

    qualification_type = "degree"
    title = factory.Sequence(lambda n: f"Qualification {n}")


class StaffDocumentFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = StaffDocument

    document_type = "contract"
    title = factory.Sequence(lambda n: f"Document {n}")
    # No SubFactory default for `file`: it must belong to the same tenant.


def enable_feature(tenant, key: str) -> None:
    """Force ``key`` on for ``tenant``, regardless of its coded default.

    Mirrors student_management.tests.factories.enable_feature exactly — see
    its docstring for why no manual cache eviction is needed here.
    """
    from core.tenancy.context import tenant_context
    from core.tenancy.models import FeatureFlag, TenantFeatureOverride

    flag = FeatureFlag.objects.get(key=key)
    with tenant_context(tenant.id):
        TenantFeatureOverride.objects.create(
            tenant=tenant, feature_flag=flag, enabled=True, reason="test setup"
        )


__all__ = [
    "CampusFactory",
    "DEFAULT_JOINING_DATE",
    "DepartmentFactory",
    "DesignationFactory",
    "FileFactory",
    "StaffDocumentFactory",
    "StaffFactory",
    "StaffQualificationFactory",
    "enable_feature",
]
