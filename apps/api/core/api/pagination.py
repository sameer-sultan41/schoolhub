"""Pagination.

Cursor pagination is the default because it stays correct and cheap on the large,
append-heavy tables in this system (attendance, ledger entries, notifications) where
offset pagination degrades and can skip or repeat rows under concurrent writes.
Offset pagination is available for small admin lists that need page numbers.

See docs/02-architecture/api-architecture.md §2.4.

`total_count` is opt-in, per endpoint, via `CountedCursorPagination`. Cursor pagination
gets its cheapness precisely by never counting, so emitting a total everywhere would put
a `COUNT(*)` over the whole filtered set on every page of every list in the product —
including the append-heavy tables this class exists to serve. The client contract has
always allowed for that (`packages/types`' `CursorPagination.total_count` is optional and
documented as "only present on endpoints cheap enough to count"); this is the mechanism
that makes it true rather than aspirational.
"""

from collections import OrderedDict
from urllib.parse import parse_qs, urlparse

from rest_framework.pagination import CursorPagination as DRFCursorPagination
from rest_framework.pagination import PageNumberPagination as DRFPageNumberPagination
from rest_framework.response import Response


class CursorPagination(DRFCursorPagination):
    page_size = 25
    max_page_size = 100
    page_size_query_param = "page_size"
    cursor_query_param = "cursor"
    ordering = "-created_at"

    #: Emit `meta.pagination.total_count`. Off here, on in `CountedCursorPagination`.
    count_total = False
    #: Set by `paginate_queryset`; `None` means this endpoint does not report a total.
    _total_count: int | None = None

    def paginate_queryset(self, queryset, request, view=None):
        # Counted BEFORE super(), on the queryset as the caller narrowed it — tenant
        # scope, record scope and filters all applied — and never on the sliced page.
        # `.count()` on an already-evaluated queryset uses its result cache, so on a
        # counted endpoint this is one extra COUNT per request, not a second full fetch.
        self._total_count = queryset.count() if self.count_total else None
        return super().paginate_queryset(queryset, request, view)

    def _cursor_token(self, link: str | None) -> str | None:
        """Return the bare cursor from one of DRF's absolute links.

        The documented contract is `?cursor=…`, so clients need the token, not a
        URL they would have to parse. Absolute links are actively wrong here: they
        are built from the request host, and a tenant reaching the API through its
        own custom domain would be handed a link pointing somewhere else.

        DRF's own encoding is reused rather than reimplemented — only the query
        parameter is lifted back out.
        """
        if not link:
            return None
        return parse_qs(urlparse(link).query).get(self.cursor_query_param, [None])[0]

    def get_paginated_response(self, data):
        return Response(
            OrderedDict(
                [
                    ("data", data),
                    (
                        "meta",
                        {"pagination": self._pagination_meta()},
                    ),
                ]
            )
        )

    def _pagination_meta(self) -> dict[str, object]:
        meta: dict[str, object] = {
            "next_cursor": self._cursor_token(self.get_next_link()),
            "previous_cursor": self._cursor_token(self.get_previous_link()),
            "page_size": self.get_page_size(self.request),
        }
        # Absent, not null, when this endpoint does not count — the client distinguishes
        # "this endpoint does not report a total" from "the total is unknown", and a null
        # would collapse the two.
        if self._total_count is not None:
            meta["total_count"] = self._total_count
        return meta

    def get_paginated_response_schema(self, schema):
        pagination_properties: dict[str, object] = {
            "next_cursor": {"type": "string", "nullable": True},
            "previous_cursor": {"type": "string", "nullable": True},
            "page_size": {"type": "integer"},
        }
        if self.count_total:
            pagination_properties["total_count"] = {"type": "integer"}

        return {
            "type": "object",
            "properties": {
                "data": schema,
                "meta": {
                    "type": "object",
                    "properties": {
                        "pagination": {
                            "type": "object",
                            "properties": pagination_properties,
                        }
                    },
                },
            },
        }


class CountedCursorPagination(CursorPagination):
    """Cursor pagination that also reports `total_count`.

    For lists a person needs a total of and that are bounded by one school's size —
    students, staff. Deliberately NOT the default: the tables cursor pagination exists
    for (attendance marks, ledger entries, notification deliveries) grow without bound,
    and a `COUNT(*)` over one of those on every page is exactly the cost this pagination
    class is chosen to avoid.
    """

    count_total = True


class PageNumberPagination(DRFPageNumberPagination):
    """Opt-in, for bounded admin lists that genuinely need page numbers.

    A page number is the one thing a cursor cannot report: a cursor knows what comes
    next, never where it is. Lists a person navigates by position — jumping to the last
    page, or back to page 3 — need this instead. See api-architecture.md §2.4 for which
    lists qualify; the constraint is that the set is bounded by one school's size, so
    the COUNT(*) each page pays for is over thousands of rows, not millions.
    """

    page_size = 25
    max_page_size = 100
    page_size_query_param = "page_size"

    def get_paginated_response(self, data):
        return Response(
            OrderedDict(
                [
                    ("data", data),
                    (
                        "meta",
                        {
                            "pagination": {
                                "page": self.page.number,
                                "page_size": self.get_page_size(self.request),
                                "total_count": self.page.paginator.count,
                                "total_pages": self.page.paginator.num_pages,
                            }
                        },
                    ),
                ]
            )
        )

    def get_paginated_response_schema(self, schema):
        """Document the envelope this class actually returns.

        Without this the class inherits DRF's stock `{count, next, previous, results}`
        schema, which is not what `get_paginated_response` above emits. openapi.yaml
        then describes a shape the API never sends, and `packages/api-client` is
        generated from openapi.yaml — so the TypeScript type for every endpoint using
        this class is wrong, and nothing fails until a reader reaches the screen.

        `CursorPagination` has carried its own override since the divergence
        `tests/test_api_contract.py` was written for; this class was simply missed, and
        `/student-promotions` has been documented wrongly ever since.
        """
        return {
            "type": "object",
            "properties": {
                "data": schema,
                "meta": {
                    "type": "object",
                    "properties": {
                        "pagination": {
                            "type": "object",
                            "properties": {
                                "page": {"type": "integer"},
                                "page_size": {"type": "integer"},
                                "total_count": {"type": "integer"},
                                "total_pages": {"type": "integer"},
                            },
                        }
                    },
                },
            },
        }
