"""Permission key owned by core.jobs.

Jobs are core platform infrastructure (api-architecture.md §2.7), not owned by
any single module doc — same reasoning as ``core.files``'s
``platform.file.*`` keys. What a job's payload does (import students,
generate ID cards, …) is gated by the module action that enqueued it
(``students.student.import``, ``students.id-card.generate``, …); this key
only gates whether the caller may poll a job's status at all — and even then,
``JobViewSet`` additionally restricts the queryset to jobs the caller
themselves created (entities/tenancy.md: "permission context is the
initiator's"), so holding this key alone never surfaces another user's job.
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
    "platform.job.view",
    "Poll a background job's status (own jobs only; core platform infrastructure).",
    ALL_STAFF,
)
