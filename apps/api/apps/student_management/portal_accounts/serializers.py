"""Request and response shapes for `:invite`, and the `portal_status` field."""

from __future__ import annotations

from typing import Any

from rest_framework import serializers

from apps.student_management.portal_accounts.services import PortalStatus, portal_status_of


class PortalStatusField(serializers.ChoiceField):
    """`portal_status`, read from the list's annotation (`with_portal_status`).

    A row that was not read through an annotated queryset (a create or update response)
    costs one query, through the same expression.
    """

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(choices=PortalStatus.choices, read_only=True, source="*", **kwargs)

    def to_representation(self, value: Any) -> str:
        status: str | None = getattr(value, "portal_status", None)
        return status if status is not None else portal_status_of(value)


class StudentInviteRequestSerializer(serializers.Serializer):
    """A student has no email on file, so the address comes with the invite.

    It is stored only on the new account. A resend goes to the existing account's address.
    """

    email = serializers.EmailField(max_length=254)


class PortalInviteResponseSerializer(serializers.Serializer):
    portal_status = serializers.ChoiceField(choices=PortalStatus.choices, read_only=True)
