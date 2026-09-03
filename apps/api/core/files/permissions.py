"""Permission keys owned by core.files.

Files are core platform infrastructure (api-architecture.md §2.8), not owned by
any single module doc — the same reasoning core.jobs uses for
``platform.job.view``. What a file may be attached TO is what a module's own
key (e.g. ``students.document.create``) actually gates; this key only gates
whether the caller can request a presigned slot and fetch a download URL at
all.

Granted to staff roles only for now — nothing in this PR gives a guardian or
student a reason to call these endpoints (parent-portal, a later tier, is what
would). Restricted principals are never staff-permission holders anyway
(auth-and-rbac.md §6 rule 4); widen this only when a concrete caller needs it,
not preemptively.
"""

from core.rbac.registry import registry

ALL_STAFF = (
    "school_owner",
    "school_admin",
    "principal",
    "vice_principal",
    "teacher",
    "class_teacher",
    "accountant",
    "finance_staff",
    "hr_staff",
    "reception",
    "admission_staff",
    "exam_staff",
    "librarian",
    "transport_manager",
    "transport_staff",
    "store_keeper",
    "it_admin",
)

registry.register(
    "platform.file.create",
    "Request a presigned upload slot and confirm it (core platform infrastructure).",
    ALL_STAFF,
)
registry.register(
    "platform.file.view",
    "Fetch a signed download URL for a file (core platform infrastructure).",
    ALL_STAFF,
)
