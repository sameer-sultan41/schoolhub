"""Factories for the student-management tests.

See school_organization/tests/factories.py's module docstring for why every
factory writes through the tenant-scoped default manager inside
``tenant_context(...)``.
"""

from __future__ import annotations

import datetime

import factory

from apps.school_organization.tests.factories import CampusFactory, HouseFactory
from apps.student_management.models import Gender, Student

DEFAULT_DOB = datetime.date(2015, 6, 1)
DEFAULT_ADMISSION_DATE = datetime.date(2026, 4, 1)


class StudentFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Student

    admission_number = factory.Sequence(lambda n: f"TEST-{n:04d}")
    first_name = factory.Sequence(lambda n: f"Student{n}")
    last_name = "Test"
    date_of_birth = DEFAULT_DOB
    gender = Gender.UNSPECIFIED
    admission_date = DEFAULT_ADMISSION_DATE
    # No SubFactory default for `campus`: it must belong to the same tenant as
    # the student, so callers pass an already-created, correctly-tenanted Campus
    # explicitly — matching CampusFactory/SectionFactory's own convention in
    # school_organization/tests/factories.py.


def enable_feature(tenant, key: str) -> None:
    """Force ``key`` on for ``tenant``, regardless of its coded default.

    The ``FeatureFlag`` row itself is created by the ``post_migrate`` sync that
    runs once when the test database is built
    (``core.tenancy.apps.TenancyConfig.ready`` ->
    ``sync_feature_flags_on_migrate``), so it already exists by the time any
    test runs — this only adds the per-tenant override, wrapped in its own
    tenant context so it is safe to call regardless of the caller's.
    """
    from django.core.cache import cache

    from core.tenancy.context import tenant_context
    from core.tenancy.models import FeatureFlag, TenantFeatureOverride

    flag = FeatureFlag.objects.get(key=key)
    with tenant_context(tenant.id):
        TenantFeatureOverride.objects.create(
            tenant=tenant, feature_flag=flag, enabled=True, reason="test setup"
        )
    cache.delete(f"feature:{tenant.id}:{key}")


__all__ = [
    "CampusFactory",
    "DEFAULT_ADMISSION_DATE",
    "DEFAULT_DOB",
    "HouseFactory",
    "StudentFactory",
    "enable_feature",
]
