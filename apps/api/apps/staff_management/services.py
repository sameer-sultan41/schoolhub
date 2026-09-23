"""Shared surface for the staff-management module.

Deliberately kept at the app root, unlike every other business rule in this
module (which now lives in one of the four resource packages —
``staff/``, ``designations/``, ``staff_qualifications/``, ``staff_documents/``
— see docs/03-modules/staff-management.md §20). Each function here is used
by more than one of those packages, or by another app entirely:

- ``resolve_tenant_staff_id`` — imported directly by
  ``apps.school_organization.services.resolve_tenant_staff_id`` (a lazy
  import there, to keep the dependency direction the module doc declares:
  staff-management depends on school-organization, not the reverse) to
  validate the ``head_staff_id``/``class_teacher_staff_id``/
  ``house_master_staff_id`` columns across several of that app's own
  resource packages.
- ``_tenant_settings`` — read by ``staff/services/numbering.py`` (the
  employee-number pattern) and ``staff_documents/services.py`` (the extra
  document-type allowlist).
- ``assert_file_usable`` — called by all three of ``staff/`` (the staff
  photo), ``staff_qualifications/`` (the qualification's evidence file) and
  ``staff_documents/`` (the document's own file).
- ``_verify_record`` — the generic verify-with-lock helper shared by
  ``staff_qualifications.verify_qualification`` and
  ``staff_documents.verify_document``, which both act on the same four
  audit fields (``verification_status``/``verified_by``/``verified_at``)
  and the same ``VerificationStatus`` enum.
"""

from __future__ import annotations

import uuid

from django.db import transaction
from django.utils import timezone

from apps.staff_management.models import EmploymentStatus, Staff, VerificationStatus
from core.api.exceptions import Conflict, DomainRuleViolation


def resolve_tenant_staff_id(
    *, staff_id: uuid.UUID | None, tenant_id: uuid.UUID
) -> uuid.UUID | None:
    """Tenant-checked resolution of a ``*_staff_id`` reference from another module.

    Used by several of school-organization's resource-package serializers
    (``campuses/``, ``departments/``, ``sections/``, ``houses/``) to validate
    ``head_staff_id`` / ``class_teacher_staff_id`` / ``house_master_staff_id``
    — those columns are
    plain UUIDs for the same cross-tenant-leak reason ``Staff.user_id`` is (see
    the model docstring), and previously had no ownership check at all.
    Imported lazily by the caller to avoid a hard import-time dependency in the
    other direction from the one docs/03-modules declares (staff-management
    depends on school-organization, not the reverse).
    """
    if staff_id is None:
        return None
    exists = (
        Staff.objects.alive()
        .filter(pk=staff_id, tenant_id=tenant_id, employment_status=EmploymentStatus.ACTIVE)
        .exists()
    )
    if not exists:
        raise DomainRuleViolation(
            {"non_field": "No active staff member with this id exists for your school."}
        )
    return staff_id


def _tenant_settings(tenant_id: uuid.UUID) -> dict:
    from core.tenancy.models import TenantSettings

    row = TenantSettings.all_tenants.filter(tenant_id=tenant_id).first()
    return (row.hr or {}) if row else {}


def assert_file_usable(*, file, purpose: str):
    """Check a resolved File instance matches the caller's intended purpose and

    is ready — mirrors student_management.services.assert_file_usable exactly.
    """
    if file.purpose != purpose:
        raise DomainRuleViolation(
            {"non_field": f"This file was uploaded for '{file.purpose}', not '{purpose}'."}
        )
    if file.status != "ready":
        raise DomainRuleViolation({"non_field": "This file's upload has not been confirmed yet."})
    return file


@transaction.atomic
def _verify_record(*, instance, decision: str, actor_id: uuid.UUID, label: str):
    """Accept or reject a verification_status/verified_by/verified_at record.

    Generic over StaffQualification and StaffDocument — both expose the same
    four audit fields and the same VerificationStatus enum.

    Re-fetches with select_for_update() rather than trusting the caller's already-read
    `instance`: without a lock, two concurrent :verify calls on the same row could both
    read PENDING, both pass the guard below, and race to overwrite each other's decision
    with no error surfaced to either caller. The second call now blocks until the first
    commits, then sees the real (already-decided) status.
    """
    locked = type(instance).objects.select_for_update().get(pk=instance.pk)
    if locked.verification_status != VerificationStatus.PENDING:
        raise Conflict(f"This {label} was already {locked.verification_status}.")
    locked.verification_status = decision
    locked.verified_by = actor_id
    locked.verified_at = timezone.now()
    locked.updated_by = actor_id
    locked.save(
        update_fields=[
            "verification_status",
            "verified_by",
            "verified_at",
            "updated_by",
            "updated_at",
        ]
    )
    return locked
