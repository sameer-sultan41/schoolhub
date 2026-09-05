"""Permission keys for the academics module — docs/03-modules/academics.md §4.

`curriculum` covers `class_subjects`, whose *model* still lives in
school_organization; academics owns the keys because §4 declares them here and
school-organization.md §6 says curriculum mapping belongs to this module. The
`school.subject.*` keys the old viewset borrowed are no longer used for it.
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

CURRICULUM_MANAGERS = ("school_admin", "principal", "vice_principal")
ALLOCATION_MANAGERS = ("school_admin", "vice_principal", "principal")
PROMOTION_REVIEWERS = ("principal", "vice_principal", "school_admin", "class_teacher")
PROMOTION_PREPARERS = ("school_admin", "vice_principal")
PROMOTION_APPROVERS = ("principal", "school_owner")
CURRICULUM_IO = ("school_admin", "it_admin")

registry.register(
    "academics.curriculum.view",
    "View class-subject curriculum, electives and term plans.",
    (*ALL_STAFF, "student", "guardian"),
)
registry.register(
    "academics.curriculum.create",
    "Add a subject to a class's curriculum for a session.",
    CURRICULUM_MANAGERS,
)
registry.register(
    "academics.curriculum.update",
    "Edit curriculum mappings, electives, period targets and term plans.",
    CURRICULUM_MANAGERS,
)
registry.register(
    "academics.curriculum.delete",
    "Remove a subject from a class's curriculum.",
    CURRICULUM_MANAGERS,
)
registry.register(
    "academics.curriculum.approve",
    "Sign off a session's curriculum before activation.",
    ("principal",),
)
registry.register("academics.curriculum.export", "Export the curriculum matrix.", CURRICULUM_IO)
registry.register("academics.curriculum.import", "Bulk-import curriculum rows.", CURRICULUM_IO)

registry.register(
    "academics.teacher-allocation.view",
    "View teacher allocations (record scope `own` for teachers).",
    ALL_STAFF,
)
registry.register(
    "academics.teacher-allocation.create",
    "Assign a teacher to a (section, subject).",
    ALLOCATION_MANAGERS,
)
registry.register(
    "academics.teacher-allocation.update",
    "Reassign or amend an allocation.",
    ALLOCATION_MANAGERS,
)
registry.register(
    "academics.teacher-allocation.delete", "Remove an allocation.", ALLOCATION_MANAGERS
)

registry.register(
    "academics.promotion.view", "View promotion batches and decisions.", PROMOTION_REVIEWERS
)
registry.register("academics.promotion.create", "Create a promotion batch.", PROMOTION_PREPARERS)
registry.register(
    "academics.promotion.update", "Edit draft promotion decisions.", PROMOTION_PREPARERS
)
registry.register(
    "academics.promotion.approve",
    "Approve or reject a promotion batch. The approver may not be the preparer.",
    PROMOTION_APPROVERS,
)
registry.register(
    "academics.promotion.execute",
    "Execute an approved batch, creating next-session enrollments.",
    ("school_admin",),
)
