"""Staff creation and the validations that gate it (module doc §6, §11).

Keeping these out of the serializer means the same rules apply whether the
write arrives from the API or the bulk importer (``services/import_staff.py``)
— mirrors student_management/services.py's layering exactly.
"""

from __future__ import annotations

import uuid
from datetime import date

from django.db import transaction

from apps.staff_management import uploads
from apps.staff_management.models import Designation, Gender, Staff
from apps.staff_management.services import assert_file_usable
from apps.staff_management.staff.services.numbering import allocate_employee_number
from core.api.exceptions import DomainRuleViolation


def resolve_tenant_user_id(*, user_id: uuid.UUID | None, tenant_id: uuid.UUID) -> uuid.UUID | None:
    """Tenant-checked resolution of a portal-account link.

    ``Staff.user_id`` is a plain UUID column rather than a ForeignKey — see the
    model docstring — precisely so this check exists explicitly instead of
    being implied by a queryset that would happily resolve another tenant's
    user.
    """
    if user_id is None:
        return None

    from core.rbac.models import User

    exists = User.objects.filter(pk=user_id, tenant_id=tenant_id).exists()
    if not exists:
        raise DomainRuleViolation({"user_id": "No user with this id exists for your school."})
    return user_id


def assert_employee_number_immutable(*, instance: Staff, new_value: str | None) -> None:
    if new_value is not None and new_value != instance.employee_number:
        raise DomainRuleViolation(
            {"employee_number": "employee_number is immutable after creation."}
        )


def assert_national_id_available(
    *, tenant_id: uuid.UUID, national_id: str, instance: Staff | None
) -> None:
    qs = Staff.objects.alive().filter(national_id=national_id)
    if instance is not None:
        qs = qs.exclude(pk=instance.pk)
    if qs.exists():
        raise DomainRuleViolation(
            {"national_id": "A staff member with this national ID already exists."}
        )


def assert_department_active(*, department, tenant_id: uuid.UUID) -> None:
    if department.tenant_id != tenant_id or not department.is_active:
        raise DomainRuleViolation({"department_id": "This department is not available."})


def assert_designation_active(*, designation: Designation, tenant_id: uuid.UUID) -> None:
    if designation.tenant_id != tenant_id or not designation.is_active:
        raise DomainRuleViolation({"designation_id": "This designation is not available."})


def assert_reports_to_acyclic(*, staff: Staff | None, reports_to: Staff) -> None:
    """Walk the ``reports_to`` chain and reject a self- or circular reference.

    No portable database constraint expresses "no cycles in this adjacency
    column" — this is service-enforced, per the module doc §11.
    """
    if staff is not None and reports_to.pk == staff.pk:
        raise DomainRuleViolation(
            {"reports_to_staff_id": "A staff member cannot report to themself."}
        )
    if staff is None:
        return
    seen = {staff.pk}
    current: Staff | None = reports_to
    while current is not None:
        if current.pk in seen:
            raise DomainRuleViolation(
                {"reports_to_staff_id": "This reporting line would create a cycle."}
            )
        seen.add(current.pk)
        current = current.reports_to


@transaction.atomic
def create_staff(
    *,
    campus,
    joining_date: date,
    first_name: str,
    last_name: str,
    staff_type: str,
    phone: str,
    department=None,
    designation=None,
    reports_to=None,
    user_id: uuid.UUID | None = None,
    photo_file=None,
    gender: str | None = None,
    date_of_birth=None,
    employment_type: str | None = None,
    email: str | None = None,
    national_id: str | None = None,
    public_bio: str | None = None,
    address: dict | None = None,
    custom_fields: dict | None = None,
    actor_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> Staff:
    """Create a staff record, allocating its employee number in the same

    transaction. Order: department/designation/national-id checks -> user_id
    tenant check -> number allocation -> insert, so a rejected create never
    consumes a sequence value — mirrors create_student's ordering rule.
    """
    if department is not None:
        assert_department_active(department=department, tenant_id=tenant_id)
    if designation is not None:
        assert_designation_active(designation=designation, tenant_id=tenant_id)
    if reports_to is not None:
        assert_reports_to_acyclic(staff=None, reports_to=reports_to)
    if national_id:
        assert_national_id_available(tenant_id=tenant_id, national_id=national_id, instance=None)
    checked_user_id = resolve_tenant_user_id(user_id=user_id, tenant_id=tenant_id)
    if photo_file is not None:
        assert_file_usable(file=photo_file, purpose=uploads.STAFF_PHOTO.key)

    employee_number = allocate_employee_number(
        campus=campus, joining_date=joining_date, tenant_id=tenant_id
    )

    return Staff.objects.create(
        tenant_id=tenant_id,
        employee_number=employee_number,
        user_id=checked_user_id,
        first_name=first_name,
        last_name=last_name,
        gender=gender or Gender.UNSPECIFIED,
        date_of_birth=date_of_birth,
        photo_file=photo_file,
        staff_type=staff_type,
        campus=campus,
        department=department,
        designation=designation,
        reports_to=reports_to,
        employment_type=employment_type or "full_time",
        joining_date=joining_date,
        email=email,
        phone=phone,
        national_id=national_id,
        public_bio=public_bio,
        address=address,
        custom_fields=custom_fields or {},
        created_by=actor_id,
        updated_by=actor_id,
    )
