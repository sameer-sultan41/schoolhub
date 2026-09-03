"""Permission keys owned by the student-management module.

Mirrors docs/03-modules/student-management.md §4 exactly. Keys are code, not
data: the registry is the single source and a migration seeds the
``permissions`` table from it, so the two cannot drift.

Module-specific verbs declared by that §4 table: ``enroll``, ``withdraw``,
``generate`` (ID cards), ``verify`` (documents). All four are already in
``core.rbac.registry.EXTRA_ACTIONS`` — no registry change was needed.

Every key in this file is registered now, in PR1, even though most of the
endpoints (guardians, documents, enrollment lifecycle, import, ID cards) land in
later PRs. That keeps the registry <-> seeded-rows equality test
(tests/test_endpoint_contracts.py) pinned to one stable target across the whole
module's PR sequence instead of growing the role matrix piecemeal.

Two keys the module doc's §16 endpoints need but §4 does not declare
(``emergency-contact.*``, ``history``-adjacent) are deliberately NOT registered
here — see the code comments at their call sites in later PRs, which reuse
``students.student.view``/``.update`` instead, matching the shipped
``ClassSubjectViewSet`` precedent in school_organization.
"""

from core.rbac.registry import registry

# "All staff" in the §4 table means every default tenant role except the
# restricted principals (student, guardian), which can never hold a staff
# permission key (auth-and-rbac.md §6 rule 4) — mirrors school_organization's
# ALL_STAFF exactly.
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

# students.student.view is the one key in this module restricted principals
# *do* hold — scoped to `own` (guardian -> own children, student -> self). This
# does not conflict with the "never a staff key" rule: the scope narrowing is
# what keeps it safe, not the absence of the grant.
STUDENT_VIEWERS = (*ALL_STAFF, "guardian", "student")

OWNER_ADMIN = ("school_owner", "school_admin")
RECORD_MANAGERS = ("school_admin", "admission_staff")
STUDENT_IO = ("school_admin", "it_admin")
DOCUMENT_MANAGERS = ("school_admin", "admission_staff")
GUARDIAN_MANAGERS = ("school_admin", "admission_staff")

registry.register(
    "students.student.view",
    "View student profiles (record scopes apply: own, assigned, campus, all).",
    STUDENT_VIEWERS,
)
registry.register(
    "students.student.create",
    "Create a student record.",
    RECORD_MANAGERS,
)
registry.register(
    "students.student.update",
    "Edit a student record.",
    ("school_admin",),
)
registry.register(
    "students.student.delete",
    "Soft-delete a student record.",
    ("school_admin",),
)
registry.register(
    "students.student.import",
    "Bulk CSV/Excel import of students (audited).",
    STUDENT_IO,
)
registry.register(
    "students.student.export",
    "Bulk CSV/Excel export of students (audited).",
    STUDENT_IO,
)
registry.register(
    "students.student.withdraw",
    "Initiate a student withdrawal.",
    ("school_admin",),
)

registry.register(
    "students.enrollment.enroll",
    "Enroll a student into a session/class/section.",
    RECORD_MANAGERS,
)
registry.register(
    "students.enrollment.update",
    "Change a student's section allocation.",
    RECORD_MANAGERS,
)

registry.register(
    "students.transfer.create",
    "Request a student transfer.",
    ("school_admin",),
)
registry.register(
    "students.transfer.approve",
    "Approve or reject a student transfer (segregation of duties: approver != initiator).",
    ("principal",),
)

registry.register(
    "students.withdrawal.approve",
    "Approve a withdrawal after clearance checks.",
    ("principal", "school_owner"),
)

registry.register(
    "students.document.view",
    "View student documents.",
    DOCUMENT_MANAGERS,
)
registry.register(
    "students.document.create",
    "Upload a student document.",
    DOCUMENT_MANAGERS,
)
registry.register(
    "students.document.verify",
    "Verify or reject a student document.",
    (*DOCUMENT_MANAGERS, "principal"),
)
registry.register(
    "students.document.delete",
    "Delete a student document.",
    DOCUMENT_MANAGERS,
)

registry.register(
    "students.guardian.view",
    "View guardians and their links to students.",
    (*GUARDIAN_MANAGERS, "reception"),
)
registry.register(
    "students.guardian.create",
    "Create a guardian or link one to a student.",
    GUARDIAN_MANAGERS,
)
registry.register(
    "students.guardian.update",
    "Edit a guardian or a student-guardian link.",
    GUARDIAN_MANAGERS,
)

registry.register(
    "students.id-card.generate",
    "Generate student ID cards (single or batch).",
    STUDENT_IO,
)
