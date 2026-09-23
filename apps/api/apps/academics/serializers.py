"""Shared serializer-layer surface for the academics module.

Deliberately kept at the app root — ``_fk`` and ``READ_ONLY_FIELDS`` are used
by every serializer in every one of the three resource packages
(docs/03-modules/academics.md §20).
"""

from __future__ import annotations

from rest_framework import serializers

READ_ONLY_FIELDS = ("id", "created_at", "updated_at")


def _fk(model, **kwargs) -> serializers.PrimaryKeyRelatedField:
    return serializers.PrimaryKeyRelatedField(queryset=model.objects, **kwargs)
