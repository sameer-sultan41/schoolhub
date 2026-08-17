"""Pagination.

Cursor pagination is the default because it stays correct and cheap on the large,
append-heavy tables in this system (attendance, ledger entries, notifications) where
offset pagination degrades and can skip or repeat rows under concurrent writes.
Offset pagination is available for small admin lists that need page numbers.

See docs/02-architecture/api-architecture.md §2.4.
"""

from collections import OrderedDict

from rest_framework.pagination import CursorPagination as DRFCursorPagination
from rest_framework.pagination import PageNumberPagination as DRFPageNumberPagination
from rest_framework.response import Response


class CursorPagination(DRFCursorPagination):
    page_size = 25
    max_page_size = 100
    page_size_query_param = "page_size"
    cursor_query_param = "cursor"
    ordering = "-created_at"

    def get_paginated_response(self, data):
        return Response(
            OrderedDict(
                [
                    ("data", data),
                    (
                        "meta",
                        {
                            "pagination": {
                                "next": self.get_next_link(),
                                "previous": self.get_previous_link(),
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
                                "next": {"type": "string", "nullable": True},
                                "previous": {"type": "string", "nullable": True},
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
                                "count": self.page.paginator.count,
                                "page": self.page.number,
                                "pages": self.page.paginator.num_pages,
                                "page_size": self.get_page_size(self.request),
                            }
                        },
                    ),
                ]
            )
        )
