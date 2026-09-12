"""Shared serializer-layer surface for the timetable module.

Deliberately kept at the app root — see ``services.py``'s module docstring
for the general shape of this rule. ``_fk`` and ``READ_ONLY_FIELDS`` are used
by every serializer in every one of the four resource packages
(docs/03-modules/timetable.md §20).
"""

from __future__ import annotations

from rest_framework import serializers

READ_ONLY_FIELDS = ("id", "created_at", "updated_at")


def _fk(model, **kwargs) -> serializers.PrimaryKeyRelatedField:
    """A related field bound to the model's *tenant-scoped* manager.

    `model.objects`, never `.all()`: the manager is what narrows the lookup to
    the caller's tenant, so a smuggled foreign id simply does not resolve.
    """
    return serializers.PrimaryKeyRelatedField(queryset=model.objects, **kwargs)
