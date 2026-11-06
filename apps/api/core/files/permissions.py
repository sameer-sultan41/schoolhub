"""Permission keys owned by core.files.

Files are core platform infrastructure (api-architecture.md §2.8), not owned by
any single module doc — the same reasoning core.jobs uses for
``platform.job.view``. What a file may be attached TO is what a module's own
key (e.g. ``students.document.create``) actually gates; this key only gates
whether the caller can request a presigned slot and fetch a download URL at
all.

``platform.file.create`` is also held by the portal roles, so a guardian or
student can upload a leave or thread attachment. It is narrowed in
``core.files.views``: a restricted principal may only request a purpose whose
spec sets ``portal_uploadable``, and may only confirm a file they created.
``platform.file.view`` stays staff-only; the portal reads a file through its
owning module's record-gated route.
"""

from core.rbac.registry import registry
from core.rbac.roles import PORTAL_ROLES

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
    (*ALL_STAFF, *PORTAL_ROLES),
)
registry.register(
    "platform.file.view",
    "Fetch a signed download URL for a file (core platform infrastructure).",
    ALL_STAFF,
)
