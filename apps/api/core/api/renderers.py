"""Response envelope renderer.

Every successful response is ``{"data": ..., "meta": {...}}``; errors are shaped by
core.api.exceptions. See docs/02-architecture/api-architecture.md §2.3.
"""

from rest_framework.renderers import JSONRenderer


class EnvelopeJSONRenderer(JSONRenderer):
    """Wraps payloads in the platform envelope exactly once.

    Already-shaped payloads (errors, paginated responses, and the OpenAPI schema)
    pass through untouched so we never double-wrap.
    """

    PASSTHROUGH_KEYS = ("error", "data")

    def render(self, data, accepted_media_type=None, renderer_context=None):
        renderer_context = renderer_context or {}
        response = renderer_context.get("response")

        if data is None:
            return b""

        if isinstance(data, dict) and any(key in data for key in self.PASSTHROUGH_KEYS):
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
