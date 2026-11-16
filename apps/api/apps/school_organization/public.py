"""Read-only organisation data for the public website, called inside a bound tenant.

website_cms imports this module and nothing else of the app's internals (ADR-0013).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from apps.school_organization.models import Campus, Class, Department

# Only these address keys are published, in this order; anything else stays internal.
_ADDRESS_KEYS = ("line1", "line2", "street", "area", "city", "state", "postal_code", "country")


@dataclass(frozen=True)
class PublicDepartmentRow:
    id: uuid.UUID
    name: str
    description: str


@dataclass(frozen=True)
class PublicClassRow:
    id: uuid.UUID
    name: str
    level: int


@dataclass(frozen=True)
class PublicContactRow:
    campus_name: str
    address: str
    phone: str
    email: str


def public_departments() -> list[PublicDepartmentRow]:
    """Active, opted-in departments by name; one query."""
    rows = (
        Department.objects.alive()
        .filter(is_active=True, show_on_website=True)
        .order_by("name", "id")
    )
    return [
        PublicDepartmentRow(id=row.id, name=row.name, description=row.description or "")
        for row in rows
    ]


def public_classes() -> list[PublicClassRow]:
    """Active, opted-in classes up the promotion ladder; one query."""
    rows = (
        Class.objects.alive().filter(is_active=True, show_on_website=True).order_by("level", "id")
    )
    return [PublicClassRow(id=row.id, name=row.name, level=row.level) for row in rows]


def format_address(address: Any) -> str:
    """One display line from the known address keys only, in `_ADDRESS_KEYS` order."""
    if not isinstance(address, dict):
        return ""
    parts = [address.get(key) for key in _ADDRESS_KEYS]
    return ", ".join(part.strip() for part in parts if isinstance(part, str) and part.strip())


def primary_campus_contact() -> PublicContactRow | None:
    """The primary active campus's contact details, or None; one query."""
    campus = Campus.objects.alive().filter(is_primary=True, is_active=True).first()
    if campus is None:
        return None
    return PublicContactRow(
        campus_name=campus.name,
        address=format_address(campus.address),
        phone=campus.phone or "",
        email=campus.email or "",
    )
