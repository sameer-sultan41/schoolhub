"""Builders for the portal-account tests: enrolled students, linked guardians, accounts.

Call them inside ``tenant_context(tenant.id)``, like every factory in this module.
"""

from __future__ import annotations

from apps.student_management.models import Guardian, Student
from apps.student_management.tests.factories import (
    AcademicSessionFactory,
    ClassFactory,
    GuardianFactory,
    SectionFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    StudentGuardianFactory,
)
from core.rbac.models import User

PORTAL_FEATURE = "module.parent_portal"
INVITE_KEY = "students.portal-account.invite"


def enrolled_student(tenant, campus, **fields) -> Student:
    """An active student with an active enrollment: eligible for the portal."""
    student = StudentFactory(tenant=tenant, campus=campus, **fields)
    school_class = ClassFactory(tenant=tenant)
    StudentEnrollmentFactory(
        tenant=tenant,
        student=student,
        academic_session=AcademicSessionFactory(tenant=tenant),
        school_class=school_class,
        section=SectionFactory(tenant=tenant, school_class=school_class, campus=campus),
    )
    return student


def linked_guardian(
    tenant, *students: Student, email: str | None = "parent@example.test", **link_fields
) -> Guardian:
    """A guardian linked to each of ``students`` (portal access on unless overridden)."""
    guardian = GuardianFactory(tenant=tenant, email=email)
    for student in students:
        StudentGuardianFactory(tenant=tenant, student=student, guardian=guardian, **link_fields)
    return guardian


def portal_account(person: Guardian | Student, *, active: bool = True) -> User:
    """A portal account linked to ``person``: active (accepted) or pending (invited)."""
    user = User.objects.create_user(
        email=f"{person.pk}@example.test", tenant_id=person.tenant_id, is_active=active
    )
    if active:
        user.set_password("test-password-portal-12345")
    else:
        user.set_unusable_password()
    user.save(update_fields=["password"])
    person.user_id = user.pk
    person.save(update_fields=["user_id"])
    return user
