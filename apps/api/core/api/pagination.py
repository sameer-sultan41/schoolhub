"""Pagination.

Cursor pagination is the default because it stays correct and cheap on the large,
append-heavy tables in this system (attendance, ledger entries, notifications) where
offset pagination degrades and can skip or repeat rows under concurrent writes.
Offset pagination is available for small admin lists that need page numbers.

See docs/02-architecture/api-architecture.md §2.4.
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
                        {
                            "pagination": {
                                "next_cursor": self._cursor_token(self.get_next_link()),
                                "previous_cursor": self._cursor_token(self.get_previous_link()),
                                "page_size": self.get_page_size(self.request),
                            }
                        },
                    ),
                ]
            )
        )

    def get_paginated_response_schema(self, schema):
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
                                "next_cursor": {"type": "string", "nullable": True},
                                "previous_cursor": {"type": "string", "nullable": True},
                                "page_size": {"type": "integer"},
                            },
                        }
                    },
                },
            },
        }


class PageNumberPagination(DRFPageNumberPagination):
    """Opt-in, for bounded admin lists that genuinely need page numbers."""

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
