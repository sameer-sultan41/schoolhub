"""Client-uploadable file purposes owned by this module (core/files/purposes.py).

Declared here rather than in a settings dict, exactly as permission keys are
declared in `permissions.py` and feature flags in `features.py` — the structure
`core/files/purposes.py` exists to enforce after `staff.photo` and two others
were used by a service and never registered, so every staff upload 422'd.
`services` references the returned spec's `.key` instead of retyping the string,
so declaring a purpose and using one are the same symbol.
"""

from core.files.purposes import MEGABYTE, registry

LEAVE_ATTACHMENT = registry.register(
    "attendance.leave-attachment",
    "A document supporting a leave request — typically a medical note (§6).",
    mime_types={"image/jpeg", "image/png", "application/pdf"},
    max_size_bytes=10 * MEGABYTE,
)

# Server-generated, never client-uploaded — `create_ready_file` writes it with
# the bytes already in hand. Registered here anyway so the purpose is declared in
# the one place this module declares purposes, rather than as a bare string in a
# task; `core/files/purposes.py`'s header is the argument for that.
REPORT_EXPORT = registry.register(
    "attendance.report-export",
    "A generated §13 attendance report (CSV).",
    mime_types={"text/csv"},
    max_size_bytes=50 * MEGABYTE,
)
