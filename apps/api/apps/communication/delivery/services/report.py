"""§13's delivery report, as a pure query function.

Mirrors `apps.fees_finance.reports`'s contract: takes an **already-scoped**
queryset rather than building its own — `SummaryActionMixin.summary` is the
only caller, and it passes its own `get_queryset()`'s result, so the
aggregation never sees a row the requester's record scope would hide.

One query, aggregated in the database — a Python loop over a tenant's delivery
history would return the right counts and time out on the tenant that sends
the most. `tests/test_report.py`'s `assertNumQueries` is what keeps it that way.
"""

from __future__ import annotations

from django.db.models import Count, QuerySet

from core.notifications.models import DeliveryLog

#: What `group_by` may name — the two axes §13's delivery report groups by.
GROUP_BY_FIELDS = {"channel": "channel", "status": "status", "provider": "provider"}


def delivery_report(queryset: QuerySet[DeliveryLog], *, group_by: str = "channel") -> list[dict]:
    """Counts per `group_by` value, most recent first within each.

    Raises `KeyError` on an unrecognised `group_by` — the view validates it
    against `GROUP_BY_FIELDS` before calling this, so reaching that branch here
    would be a bug in the caller, not a user error to render nicely.
    """
    field = GROUP_BY_FIELDS[group_by]
    rows = queryset.values(field).annotate(count=Count("id")).order_by("-count", field)
    return [{"group": row[field], "count": row["count"]} for row in rows]
