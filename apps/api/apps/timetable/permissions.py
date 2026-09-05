"""Permission keys for the timetable module — docs/03-modules/timetable.md §4.

`timetable.timetable.view` covers the *published* grid and is granted to every
role, record-scoped; `timetable.slot.view` is the separate key §4 declares for
seeing **drafts**, and is deliberately narrow — an unpublished timetable must
never leak to students or guardians (§5.7).
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

DRAFT_VIEWERS = ("school_admin", "vice_principal", "principal")
BUILDERS = ("school_admin", "vice_principal")
PUBLISHERS = ("principal", "vice_principal", "school_admin")
GRID_ADMINS = ("school_admin",)
SUBSTITUTION_APPROVERS = ("vice_principal", "principal")

registry.register(
    "timetable.timetable.view",
    "View published timetables (record scopes apply: own, assigned, all).",
    (*ALL_STAFF, "student", "guardian"),
)
registry.register(
    "timetable.timetable.publish",
    "Publish or republish a section's timetable.",
    PUBLISHERS,
)
registry.register(
    "timetable.timetable.export", "Export or print timetables.", (*PUBLISHERS, "teacher")
)

registry.register("timetable.slot.view", "View unpublished draft slots.", DRAFT_VIEWERS)
registry.register("timetable.slot.create", "Add a draft slot.", BUILDERS)
registry.register("timetable.slot.update", "Edit a draft slot.", BUILDERS)
registry.register("timetable.slot.delete", "Remove a draft slot.", BUILDERS)

registry.register("timetable.period.create", "Add a period to the bell schedule.", GRID_ADMINS)
registry.register("timetable.period.update", "Edit a period.", GRID_ADMINS)
registry.register("timetable.period.delete", "Remove a period.", GRID_ADMINS)

registry.register("timetable.room.create", "Add a room.", GRID_ADMINS)
registry.register("timetable.room.update", "Edit a room or its capacity.", GRID_ADMINS)
registry.register("timetable.room.delete", "Remove a room.", GRID_ADMINS)

registry.register("timetable.substitution.create", "Propose a substitution.", BUILDERS)
registry.register(
    "timetable.substitution.approve",
    "Approve or reject a substitution.",
    SUBSTITUTION_APPROVERS,
)
