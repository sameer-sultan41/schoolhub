"""The date rules for an allocation's `effective_from` / `effective_to` — academics.md §20.

Cut from `services.py`, which they would push past the size convention. The serializer and
`services.update_allocation` both call `assert_patch_dates_valid`, so a PATCH is checked once
as a field error (400) and again in the service for non-API callers.
"""

from __future__ import annotations

from datetime import date

from django.utils import timezone

from core.api.exceptions import DomainRuleViolation


def assert_patch_dates_valid(
    *, changes: dict, current_from: date | None, current_to: date | None
) -> None:
    """The date rules for a PATCH, shared by the serializer and `update_allocation`.

    Ordering runs whenever either date is sent; the future ceiling only when `effective_to`
    is, since a primary displaced from a future start already carries a future `effective_to`.
    """
    if "effective_from" not in changes and "effective_to" not in changes:
        return
    assert_end_date_valid(
        effective_from=changes.get("effective_from", current_from),
        effective_to=changes.get("effective_to", current_to),
        check_future="effective_to" in changes,
        # A PATCH that moves only the start is the one that broke the order: put it on that field.
        order_field="effective_to" if "effective_to" in changes else "effective_from",
    )


def assert_end_date_valid(
    *,
    effective_from: date | None,
    effective_to: date | None,
    check_future: bool = True,
    order_field: str = "effective_to",
) -> None:
    """An end date is never before the start, and (with `check_future`) never after today.

    `order_field` is the field the "before the start" error is keyed to, so a form can place it
    under the date the user just edited.
    """
    if effective_to is None:
        return
    if check_future and effective_to > timezone.localdate():
        raise DomainRuleViolation({"effective_to": "An allocation cannot be ended in the future."})
    if effective_from and effective_to < effective_from:
        raise DomainRuleViolation({order_field: "The end date cannot be before the start date."})
