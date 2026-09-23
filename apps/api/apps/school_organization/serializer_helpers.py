"""Serializer field-building helpers shared by every resource package below.

Used by campuses, departments, academic_sessions, terms, sections, classes,
subjects and houses' serializers — no single package owns these, so,
following the same shared-by-more-than-one-sibling rule `services.py` and
`views.py` use (see their docstrings), they live here rather than in any one
resource's `serializers.py`. Unlike those two files, nothing outside this app
imports this one, so it carries no external-contract constraint — it exists
purely to avoid eight copies of the same two helpers.
"""

from __future__ import annotations

from typing import overload

from rest_framework import serializers

# Written by the base viewset from the request, never by the client.
READ_ONLY_FIELDS = ("id", "created_at", "updated_at")


def fk(model, **kwargs) -> serializers.PrimaryKeyRelatedField:
    """A tenant-scoped related field.

    The *manager* is passed rather than ``manager.all()``: DRF re-evaluates it on
    every request, so the tenant filter runs inside a tenant context. A queryset
    built at import time would be frozen empty, and would silently reject every id.
    """
    return serializers.PrimaryKeyRelatedField(queryset=model.objects, **kwargs)


@overload
def normalize_code(value: str) -> str: ...


@overload
def normalize_code(value: None) -> None: ...


def normalize_code(value: str | None) -> str | None:
    """Codes are matched by humans and by importers; case and padding are noise."""
    return value.strip().upper() if value else value
