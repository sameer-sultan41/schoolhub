"""Shared serializer-layer surface for the staff-management module.

Deliberately kept at the app root — see ``services.py``'s module docstring
for the general shape of this rule.

- ``_fk`` and ``READ_ONLY_FIELDS`` are used by every serializer in every one
  of the four resource packages (docs/03-modules/staff-management.md §20).
- ``VerifyRequestSerializer`` is the trivial ``{decision}`` payload shared by
  both ``staff_qualifications``' and ``staff_documents``' ``:verify``
  colon-actions.
"""

from __future__ import annotations

from rest_framework import serializers

READ_ONLY_FIELDS = ("id", "created_at", "updated_at")


def _fk(model, **kwargs) -> serializers.PrimaryKeyRelatedField:
    """A tenant-scoped related field — see school_organization/
    serializer_helpers.py's identical ``fk()`` helper for why the *manager*,
    not ``manager.all()``, is passed.
    """
    return serializers.PrimaryKeyRelatedField(queryset=model.objects, **kwargs)


class VerifyRequestSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=["verified", "rejected"])
