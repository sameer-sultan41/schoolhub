"""Shared view-layer surface for the staff-management module.

Deliberately kept at the app root — see ``services.py``'s module docstring
for the general shape of this rule. Both classes here are used by every one
of the four resource packages (``staff/``, ``designations/``,
``staff_qualifications/``, ``staff_documents/`` — docs/03-modules/
staff-management.md §20):

- ``_StaffModuleViewSetMixin`` adds ``DenyRestrictedPrincipals`` on top of
  the base tenant-scoped permission stack — this module was its first real
  consumer (previously zero call sites anywhere in the codebase): students
  and guardians must never reach a staff endpoint, even via a hypothetical
  custom role that somehow carries a ``staff.*`` key. Every viewset in every
  package subclasses it.
- ``_NestedUnderStaffMixin`` resolves the parent staff record from the URL
  for the two nested routes (``staff/{staff_pk}/qualifications`` and
  ``staff/{staff_pk}/documents``), which live in the
  ``staff_qualifications``/``staff_documents`` packages respectively —
  mirrors student_management's ``_NestedUnderStudentMixin`` exactly,
  including the malformed-UUID-is-a-404 handling.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework.permissions import IsAuthenticated

if TYPE_CHECKING:
    from rest_framework.request import Request

from apps.staff_management.models import Staff
from core.api.permissions import RequiresModuleFeature
from core.api.viewsets import TenantScopedViewSetMixin
from core.rbac.permissions import DenyRestrictedPrincipals, HasPermissionKey


class _StaffModuleViewSetMixin(TenantScopedViewSetMixin):
    """Adds ``DenyRestrictedPrincipals`` to the base tenant-scoped stack — see

    this module's docstring for why every staff endpoint needs it.
    """

    permission_classes = [
        IsAuthenticated,
        RequiresModuleFeature,
        HasPermissionKey,
        DenyRestrictedPrincipals,
    ]


class _NestedUnderStaffMixin:
    """Resolves the parent staff record from the URL — mirrors

    student_management's ``_NestedUnderStudentMixin`` exactly, including the
    malformed-UUID-is-a-404 handling.
    """

    if TYPE_CHECKING:
        request: Request
        kwargs: dict[str, str]

    def get_staff(self) -> Staff:
        from core.rbac.permissions import scope_queryset

        queryset = scope_queryset(Staff.objects.alive(), self.request.user, own_field="user_id")
        try:
            return get_object_or_404(queryset, pk=self.kwargs["staff_pk"])
        except (ValueError, TypeError) as exc:
            raise Http404 from exc
