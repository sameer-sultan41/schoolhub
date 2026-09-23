"""Business rules for the EmergencyContact resource.

Split out of the app-root ``services.py`` — this resource has no rule beyond
the plain insert, so unlike ``guardians``/``student_documents`` there is
nothing shared to import back from the root.
"""

from __future__ import annotations

import uuid

from apps.student_management.models import EmergencyContact, Student


def add_emergency_contact(
    *,
    student: Student,
    name: str,
    relationship: str,
    phone: str,
    alt_phone: str | None = None,
    priority: int = 1,
    notes: str | None = None,
    actor_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> EmergencyContact:
    return EmergencyContact.objects.create(
        tenant_id=tenant_id,
        student=student,
        name=name,
        relationship=relationship,
        phone=phone,
        alt_phone=alt_phone,
        priority=priority,
        notes=notes,
        created_by=actor_id,
        updated_by=actor_id,
    )
