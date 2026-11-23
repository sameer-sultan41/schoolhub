"""Request correlation, and the load balancer's liveness probe.

Every request carries an id that appears in the response header, in every log line,
and in the error envelope, so a user-reported failure can be traced end to end.
"""

import uuid
from contextvars import ContextVar

from django.http import JsonResponse

HEALTH_PATH = "/healthz"

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


class HealthCheckMiddleware:
    """Answers `GET /healthz` before any host check, SSL redirect or CORS handling.

    The ALB probes a task by its IP with no `X-Forwarded-Proto`, so under prod.py the full
    stack would answer 400 (`DisallowedHost`) or 301 and the target would never turn healthy.
    First in `MIDDLEWARE`; every other path, `/readyz` included, takes the full stack.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path == HEALTH_PATH and request.method in ("GET", "HEAD"):
            return JsonResponse({"status": "ok"})
        return self.get_response(request)
