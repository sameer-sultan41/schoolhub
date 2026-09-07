"""File purposes owned by this module (core/files/purposes.py).

Declared here rather than as bare strings in a task, exactly as permission keys
are declared in `permissions.py` and feature flags in `features.py` — the
structure `core/files/purposes.py` exists to enforce after `staff.photo` and two
others were used by a service and never registered, so every upload 422'd.
Callers reference the returned spec's `.key`, so declaring a purpose and using
one are the same symbol.

Every purpose here is **server-generated**: nothing in this module accepts a
client upload yet. They are registered anyway, because `create_ready_file`
validates against the same registry, and because a purpose invented inline in a
Celery task is a purpose nobody can find.
"""

from core.files.purposes import MEGABYTE, registry

ADMIT_CARD = registry.register(
    "exams.admit-card",
    "A rendered admit card for one student for one exam (§5.3).",
    mime_types={"application/pdf"},
    max_size_bytes=5 * MEGABYTE,
)
