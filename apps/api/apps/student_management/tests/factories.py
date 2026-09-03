"""Factories for the student-management tests.

See school_organization/tests/factories.py's module docstring for why every
factory writes through the tenant-scoped default manager inside
``tenant_context(...)``.
"""

from __future__ import annotations

import datetime

import factory

from apps.school_organization.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    HouseFactory,
    SectionFactory,
)
from apps.student_management.models import (
    EmergencyContact,
    Gender,
    Guardian,
    Relationship,
    Student,
    StudentDocument,
    StudentEnrollment,
    StudentGuardian,
    StudentTransfer,
    TransferType,
)
from core.files.tests.factories import FileFactory

DEFAULT_DOB = datetime.date(2015, 6, 1)
DEFAULT_ADMISSION_DATE = datetime.date(2026, 4, 1)
# Inside AcademicSessionFactory's default SESSION_START/SESSION_END window
# (school_organization/tests/factories.py).
DEFAULT_ENROLLMENT_DATE = datetime.date(2026, 4, 5)


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


class GuardianFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Guardian

    first_name = factory.Sequence(lambda n: f"Guardian{n}")
    last_name = "Test"
    phone = factory.Sequence(lambda n: f"+92300{n:07d}")


class StudentGuardianFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = StudentGuardian

    relationship = Relationship.FATHER


class EmergencyContactFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = EmergencyContact

    name = factory.Sequence(lambda n: f"Contact{n}")
    relationship = "aunt"
    phone = factory.Sequence(lambda n: f"+92301{n:07d}")


class StudentDocumentFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = StudentDocument

    document_type = "birth_certificate"
    title = factory.Sequence(lambda n: f"Document {n}")
    # No SubFactory default for `file`: it must belong to the same tenant, same
    # as `campus`/`student` elsewhere in this file.


class StudentEnrollmentFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = StudentEnrollment

    enrollment_date = DEFAULT_ENROLLMENT_DATE
    # No SubFactory defaults for academic_session/school_class/section/student:
    # each must belong to the same tenant and satisfy section_id -> class_id,
    # so callers wire them up explicitly — same convention as StudentFactory's
    # campus.


class StudentTransferFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = StudentTransfer

    transfer_type = TransferType.INTER_CAMPUS
    reason = "Family relocation."
    effective_date = DEFAULT_ENROLLMENT_DATE


def enable_feature(tenant, key: str) -> None:
    """Force ``key`` on for ``tenant``, regardless of its coded default.

    The ``FeatureFlag`` row itself is created by the ``post_migrate`` sync that
    runs once when the test database is built
    (``core.tenancy.apps.TenancyConfig.ready`` ->
    ``sync_feature_flags_on_migrate``), so it already exists by the time any
    test runs — this only adds the per-tenant override, wrapped in its own
    tenant context so it is safe to call regardless of the caller's.
    ``TenantFeatureOverride.objects.create`` fires the ``post_save`` signal,
    which evicts the cached resolution itself (core/tenancy/signals.py) — no
    manual cache eviction needed here.
    """
    from core.tenancy.context import tenant_context
    from core.tenancy.models import FeatureFlag, TenantFeatureOverride

    flag = FeatureFlag.objects.get(key=key)
    with tenant_context(tenant.id):
        TenantFeatureOverride.objects.create(
            tenant=tenant, feature_flag=flag, enabled=True, reason="test setup"
        )


__all__ = [
    "AcademicSessionFactory",
    "CampusFactory",
    "ClassFactory",
    "DEFAULT_ADMISSION_DATE",
    "DEFAULT_DOB",
    "DEFAULT_ENROLLMENT_DATE",
    "EmergencyContactFactory",
    "FileFactory",
    "GuardianFactory",
    "HouseFactory",
    "SectionFactory",
    "StudentDocumentFactory",
    "StudentEnrollmentFactory",
    "StudentFactory",
    "StudentGuardianFactory",
    "StudentTransferFactory",
    "enable_feature",
]
