"""Business rules for the StaffDocument resource.

Document-exclusive rules split out of the app-root ``services.py`` — see
docs/03-modules/staff-management.md §20's file-per-action package layout.
Shared helpers (``_tenant_settings``, ``assert_file_usable``, ``_verify_record``)
stay in the app root and are imported from there.
"""

from __future__ import annotations

import uuid

from django.db import transaction

from apps.staff_management import uploads
from apps.staff_management.models import DEFAULT_DOCUMENT_TYPES, Staff, StaffDocument
from apps.staff_management.services import _tenant_settings, _verify_record, assert_file_usable
from core.api.exceptions import DomainRuleViolation


def _document_type_allowed(*, document_type: str, tenant_id: uuid.UUID) -> bool:
    extra = _tenant_settings(tenant_id).get("staff_document_types") or []
    return document_type in DEFAULT_DOCUMENT_TYPES or document_type in extra


def assert_document_type_allowed(*, document_type: str, tenant_id: uuid.UUID) -> None:
    if not _document_type_allowed(document_type=document_type, tenant_id=tenant_id):
        raise DomainRuleViolation(
            {"document_type": f"'{document_type}' is not a recognised document type."}
        )


@transaction.atomic
def add_staff_document(
    *,
    staff: Staff,
    file,
    document_type: str,
    title: str,
    notes: str | None = None,
    expires_at=None,
    actor_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> StaffDocument:
    assert_document_type_allowed(document_type=document_type, tenant_id=tenant_id)
    assert_file_usable(file=file, purpose=uploads.STAFF_DOCUMENT.key)

    return StaffDocument.objects.create(
        tenant_id=tenant_id,
        staff=staff,
        file=file,
        document_type=document_type,
        title=title,
        notes=notes,
        expires_at=expires_at,
        created_by=actor_id,
        updated_by=actor_id,
    )


def verify_document(
    *, document: StaffDocument, decision: str, actor_id: uuid.UUID
) -> StaffDocument:
    """Accept or reject a document — mirrors student_management's identical

    rejection of re-verifying an already-decided document.
    """
    return _verify_record(instance=document, decision=decision, actor_id=actor_id, label="document")
