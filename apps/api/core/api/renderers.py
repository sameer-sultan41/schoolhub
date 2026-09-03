"""Response envelope renderer.

Every successful response is ``{"data": ..., "meta": {...}}``; errors are shaped by
core.api.exceptions. See docs/02-architecture/api-architecture.md §2.3.
"""

from rest_framework.renderers import JSONRenderer


def _is_error_envelope(data: dict) -> bool:
    """True only for a real `envelope_exception_handler` payload.

    Checking merely `"error" in data` is not enough: a model field named
    `error` (core.jobs.BackgroundJob.error, a plain string/None) makes that
    check true for an ordinary successful response too, silently skipping the
    `{"data": ...}` wrap for anything serializing such a field. A real error
    envelope's `error` value is always this specific structured dict.
    """
    error = data.get("error")
    return isinstance(error, dict) and "code" in error and "message" in error


def _is_pre_wrapped_data(data: dict) -> bool:
    """True only for a payload a view already built as `{"data": ..., "meta": ...}`

    (``ActionResponse.ok``/``.accepted``). Checking merely `"data" in data`
    has the same false-positive risk `_is_error_envelope` guards against, so
    this also requires no *other* top-level keys are present — a serialized
    model happening to have a field named `data` would otherwise trip this
    too.
    """
    return "data" in data and set(data.keys()) <= {"data", "meta"}


class EnvelopeJSONRenderer(JSONRenderer):
    """Wraps payloads in the platform envelope exactly once.

    Already-shaped payloads (errors, paginated responses, and the OpenAPI schema)
    pass through untouched so we never double-wrap.
    """

    def render(self, data, accepted_media_type=None, renderer_context=None):
        renderer_context = renderer_context or {}
        response = renderer_context.get("response")

        if data is None:
            return b""

        if isinstance(data, dict) and (_is_error_envelope(data) or _is_pre_wrapped_data(data)):
            payload = data
        else:
            payload = {"data": data}

        if isinstance(payload, dict) and "error" not in payload:
            meta = payload.setdefault("meta", {})
            request = renderer_context.get("request")
            request_id = getattr(request, "request_id", None)
            if request_id:
                meta["request_id"] = request_id
            if response is not None and not meta:
                payload.pop("meta")

        return super().render(payload, accepted_media_type, renderer_context)
