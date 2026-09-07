"""Filter backends.

See docs/02-architecture/api-architecture.md §2.4 for the query-parameter contract.
"""

from rest_framework.filters import OrderingFilter as DRFOrderingFilter


class StableOrderingFilter(DRFOrderingFilter):
    """Ordering that never leaves a cursor page boundary ambiguous.

    DRF's `CursorPagination.get_ordering()` does not use its own `ordering` attribute
    when a filter backend on the view exposes `get_ordering` — it adopts whatever this
    backend returns as the cursor key instead. `OrderingFilter` is a project-wide
    default (settings `DEFAULT_FILTER_BACKENDS`), so every cursor-paginated list in the
    product already works that way.

    That is fine while the key is `-created_at`. It stops being fine the moment a client
    sends `?ordering=name`: none of the columns a person wants to sort by is unique.

    DRF does handle ties — its cursor carries an `offset` counting how many rows sharing
    the boundary value were already served, and resumes by skipping that many. But that
    only works if re-running the query returns the tied rows in the SAME sequence.
    Postgres guarantees no such thing: with `ORDER BY name` alone the rows sharing a name
    may come back in any order, and often do once the planner switches between a sort and
    an index scan as the table grows. The offset then resumes at a different row, and the
    page silently skips or repeats — with a 200 and a page that looks right.

    Appending the primary key makes the order total, so the sequence is identical every
    time and the offset lands where it was meant to. `pk` is unique and indexed on every
    table here, so the tiebreaker costs nothing.

    The base class has already validated the requested fields against the view's
    `ordering_fields` allowlist by the time this runs, so nothing user-supplied reaches
    the queryset through the addition below.
    """

    def get_ordering(self, request, queryset, view):
        ordering = super().get_ordering(request, queryset, view)
        if not ordering:
            # No `?ordering=` and no view default: the paginator keeps its own
            # `-created_at`, which is already deterministic enough for a cursor because
            # it is only ever combined with the pk tiebreaker DRF adds itself.
            return ordering

        if any(field.lstrip("-") == "pk" for field in ordering):
            return ordering

        return [*ordering, "pk"]
