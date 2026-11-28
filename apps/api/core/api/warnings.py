"""`meta.warnings`: advice a 2xx response carries (api-architecture.md §2).

A service that wants the caller told something, without refusing the write, adds a
``{code, message, details}`` dict here; the envelope renderer puts the request's list in
``meta.warnings``. Outside a request (a task, a shell) there is no list and adding is a no-op.
"""

from __future__ import annotations

from contextvars import ContextVar

_warnings: ContextVar[list[dict] | None] = ContextVar("response_warnings", default=None)


def add_response_warning(warning: dict) -> None:
    pending = _warnings.get()
    if pending is not None and warning not in pending:
        pending.append(warning)


def response_warnings() -> list[dict]:
    return list(_warnings.get() or [])


class ResponseWarningsMiddleware:
    """Gives each request its own, empty list of warnings."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        token = _warnings.set([])
        try:
            return self.get_response(request)
        finally:
            _warnings.reset(token)
