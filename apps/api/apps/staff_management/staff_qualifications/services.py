"""Service logic exclusive to the staff-qualifications resource.

Shared, cross-package logic stays in the module root's
``apps.staff_management.services``: ``_verify_record`` (the generic
verify-with-lock helper shared with ``staff_documents``'s ``verify_document``).
``assert_file_usable`` is the platform's, in ``core.files.services``.
"""

from __future__ import annotations

import uuid

from django.db import transaction
from django.utils import timezone

from apps.staff_management import uploads
from apps.staff_management.models import Staff, StaffQualification
from apps.staff_management.services import _verify_record
from core.api.exceptions import DomainRuleViolation
from core.files.services import assert_file_usable


def assert_year_not_future(year_awarded: int) -> None:
    if year_awarded > timezone.now().year:
        raise DomainRuleViolation({"year_awarded": "year_awarded cannot be in the future."})


@transaction.atomic
def add_staff_qualification(
    *,
    staff: Staff,
    qualification_type: str,
    title: str,
    institution: str | None = None,
    field_of_study: str | None = None,
    year_awarded: int | None = None,
    grade: str | None = None,
    document_file=None,
    actor_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> StaffQualification:
    if year_awarded is not None:
        assert_year_not_future(year_awarded)
    if document_file is not None:
        assert_file_usable(file=document_file, purpose=uploads.STAFF_QUALIFICATION.key)

    return StaffQualification.objects.create(
        tenant_id=tenant_id,
        staff=staff,
        qualification_type=qualification_type,
        title=title,
        institution=institution,
        field_of_study=field_of_study,
        year_awarded=year_awarded,
        grade=grade,
        document_file=document_file,
        created_by=actor_id,
        updated_by=actor_id,
    )


def verify_qualification(
    *, qualification: StaffQualification, decision: str, actor_id: uuid.UUID
) -> StaffQualification:
    return _verify_record(
        instance=qualification, decision=decision, actor_id=actor_id, label="qualification"
    )
