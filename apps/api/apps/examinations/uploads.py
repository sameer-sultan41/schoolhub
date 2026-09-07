"""File purposes owned by this module (core/files/purposes.py).

Declared here rather than as bare strings in a task, exactly as permission keys
are declared in `permissions.py` and feature flags in `features.py` — the
structure `core/files/purposes.py` exists to enforce after `staff.photo` and two
others were used by a service and never registered, so every upload 422'd.
Callers reference the returned spec's `.key`, so declaring a purpose and using
one are the same symbol.

`ADMIT_CARD` is server-generated — `create_ready_file` writes it with the bytes
already in hand — and registered anyway, because that helper validates against
this same registry and because a purpose invented inline in a Celery task is a
purpose nobody can find. `MARKS_IMPORT` is genuinely client-uploaded, so its
MIME list is the gate `POST /files` enforces rather than a description of what
the server produced.
"""

from core.files.purposes import MEGABYTE, registry

ADMIT_CARD = registry.register(
    "exams.admit-card",
    "A rendered admit card for one student for one exam (§5.3).",
    mime_types={"application/pdf"},
    max_size_bytes=5 * MEGABYTE,
)

MARKS_IMPORT = registry.register(
    "exams.marks-import",
    "A marks sheet being imported for one exam-subject (§9).",
    mime_types={
        "text/csv",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    max_size_bytes=10 * MEGABYTE,
)

REPORT_CARD = registry.register(
    "exams.report-card",
    "A rendered report card for one student for one exam (§5.7).",
    mime_types={"application/pdf"},
    max_size_bytes=5 * MEGABYTE,
)

EXAM_PAPER = registry.register(
    "exams.exam-paper",
    "An assembled exam paper, rendered from a question bank (§5.8).",
    mime_types={"application/pdf"},
    max_size_bytes=10 * MEGABYTE,
)

# §13's exports, in all three of the formats `core.exports.tabular` renders.
RESULT_EXPORT = registry.register(
    "exams.result-export",
    "A generated §13 examinations report (CSV, XLSX or PDF).",
    mime_types={
        "text/csv",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/pdf",
    },
    max_size_bytes=50 * MEGABYTE,
)
