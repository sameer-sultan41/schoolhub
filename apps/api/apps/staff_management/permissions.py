"""Permission keys owned by the staff-management module.

Mirrors docs/03-modules/staff-management.md §4 exactly. Keys are code, not
data: the registry is the single source and a migration seeds the
``permissions`` table from it, so the two cannot drift.

Module-specific verb declared by that §4 table: ``verify`` (documents/
qualifications) — already in ``core.rbac.registry.EXTRA_ACTIONS``, no registry
change needed. ``:invite`` and ``:exit`` are colon-actions with no dedicated
§4 key; per this module's own convention (student_management's precedent),
they reuse the parent resource's key — ``staff.staff.update`` for invite,
``staff.staff.delete`` for exit (§4: "delete = soft; exit workflow preferred").

Every key in this file is registered now, even though performance-review
endpoints do not ship in this PR (``staff_performance_reviews`` is a §19
recommendation, not in the locked entity map). That keeps the registry <->
seeded-rows equality test (tests/test_endpoint_contracts.py) pinned to the
full module doc, matching student_management's own precedent of registering
every §4 key up front.

Staff members are never restricted principals (students, guardians never hold
a staff.* key — auth-and-rbac.md §6 rule 4, enforced again at the view layer by
``core.rbac.permissions.DenyRestrictedPrincipals``), so unlike
student_management there is no "student/guardian can view their own" carve-out
here.
"""

from core.rbac.registry import registry

# Mirrors school_organization/student_management's ALL_STAFF exactly.
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

RECORD_MANAGERS = ("hr_staff", "school_admin")
STAFF_IO = ("hr_staff", "it_admin")
DESIGNATION_MANAGERS = ("school_admin", "hr_staff")
REVIEW_AUTHORS = ("principal", "vice_principal", "hr_staff")

registry.register(
    "staff.staff.view",
    "View staff profiles (record scopes apply: own, campus, all; "
    "salary-adjacent fields are masked without hr permissions).",
    ALL_STAFF,
)
registry.register(
    "staff.staff.create",
    "Create a staff record.",
    RECORD_MANAGERS,
)
registry.register(
    "staff.staff.update",
    "Edit a staff record (also required for :invite).",
    RECORD_MANAGERS,
)
registry.register(
    "staff.staff.delete",
    "Soft-delete a staff record (also required for :exit).",
    RECORD_MANAGERS,
)
registry.register(
    "staff.staff.import",
    "Bulk CSV/Excel import of staff (audited).",
    STAFF_IO,
)
registry.register(
    "staff.staff.export",
    "Bulk CSV/Excel export of staff (audited).",
    STAFF_IO,
)

registry.register(
    "staff.designation.view",
    "View the designation catalog.",
    ALL_STAFF,
)
registry.register(
    "staff.designation.create",
    "Create a designation.",
    DESIGNATION_MANAGERS,
)
registry.register(
    "staff.designation.update",
    "Edit a designation.",
    DESIGNATION_MANAGERS,
)
registry.register(
    "staff.designation.delete",
    "Delete a designation (blocked while any staff record is assigned).",
    DESIGNATION_MANAGERS,
)

registry.register(
    "staff.qualification.view",
    "View staff qualifications (own qualifications are always visible to their owner).",
    ALL_STAFF,
)
registry.register(
    "staff.qualification.create",
    "Add a qualification (own-create is allowed for every staff member).",
    ALL_STAFF,
)
registry.register(
    "staff.qualification.update",
    "Edit a qualification.",
    ("hr_staff",),
)
registry.register(
    "staff.qualification.verify",
    "Verify or reject a qualification.",
    ("hr_staff", "principal"),
)

registry.register(
    "staff.document.view",
    "View staff documents (own documents are always visible to their owner).",
    ALL_STAFF,
)
registry.register(
    "staff.document.create",
    "Upload a staff document (own-upload is allowed for every staff member).",
    ALL_STAFF,
)
registry.register(
    "staff.document.verify",
    "Verify or reject a staff document.",
    ("hr_staff",),
)
registry.register(
    "staff.document.delete",
    "Delete a staff document.",
    ("hr_staff",),
)

registry.register(
    "staff.performance-review.view",
    "View performance reviews (reviewer chain + hr; own finalized review visible to its subject).",
    REVIEW_AUTHORS,
)
registry.register(
    "staff.performance-review.create",
    "Draft a performance review.",
    REVIEW_AUTHORS,
)
registry.register(
    "staff.performance-review.update",
    "Edit a draft performance review.",
    REVIEW_AUTHORS,
)
registry.register(
    "staff.performance-review.approve",
    "Finalize a performance review (segregation of duties: approver != subject).",
    ("principal", "school_owner"),
)
