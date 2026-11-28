"""Structured JSON logging.

One JSON object per line, with request and tenant correlation attached automatically
so logs are queryable per school without every call site remembering to pass context.
"""

import json
import logging
from datetime import UTC, datetime

# Attributes LogRecord always carries; anything else the caller passed via `extra`
# is treated as structured context and merged into the payload.
_STANDARD_ATTRS = frozenset(
    {
        "args",
        "asctime",
        "created",
        "exc_info",
        "exc_text",
        "filename",
        "funcName",
        "levelname",
        "levelno",
        "lineno",
        "module",
        "msecs",
        "message",
        "msg",
        "name",
        "pathname",
        "process",
        "processName",
        "relativeCreated",
        "stack_info",
        "taskName",
        "thread",
        "threadName",
    }
)


class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        from core.api.middleware import get_current_request_id
        from core.rbac.impersonation import get_current_impersonation
        from core.tenancy.context import get_current_tenant_id

        payload = {
            "timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        request_id = get_current_request_id()
        if request_id:
            payload["request_id"] = request_id

        tenant_id = get_current_tenant_id()
        if tenant_id:
            payload["tenant_id"] = str(tenant_id)

        # Every line written under an impersonation names the operator (ADR-0037).
        impersonation = get_current_impersonation()
        if impersonation is not None:
            payload["impersonated_by"] = str(impersonation.operator_id)
            payload["grant_id"] = str(impersonation.grant_id)

        for key, value in record.__dict__.items():
            if key not in _STANDARD_ATTRS and not key.startswith("_"):
                payload[key] = value

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        return json.dumps(payload, default=str)
