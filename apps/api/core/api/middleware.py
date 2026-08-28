"""Request correlation.

Every request carries an id that appears in the response header, in every log line,
and in the error envelope, so a user-reported failure can be traced end to end.
"""

import uuid
from contextvars import ContextVar

REQUEST_ID_HEADER = "HTTP_X_REQUEST_ID"
RESPONSE_HEADER = "X-Request-ID"

_current_request_id: ContextVar[str | None] = ContextVar("current_request_id", default=None)


def get_current_request_id() -> str | None:
    return _current_request_id.get()


class RequestIDMiddleware:
    """Accepts an upstream X-Request-ID or mints one, then binds it for the request."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Only trust an upstream value that looks like a UUID, so the header cannot
        # be used to inject arbitrary content into logs. META always yields a string,
        # so a malformed value raises ValueError and nothing else.
        try:
            request_id = str(uuid.UUID(request.META.get(REQUEST_ID_HEADER, "")))
        except ValueError:
            request_id = str(uuid.uuid4())

        request.request_id = request_id
        token = _current_request_id.set(request_id)
        try:
            response = self.get_response(request)
            response[RESPONSE_HEADER] = request_id
            return response
        finally:
            _current_request_id.reset(token)
