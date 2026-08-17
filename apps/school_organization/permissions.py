"""Permission keys owned by the school-organization module.

Mirrors schoolhub-srd/docs/03-modules/school-organization.md §4 exactly. Keys are
code, not data: the registry is the single source and a migration seeds the
``permissions`` table from it, so the two cannot drift.

Module-specific verbs declared by that §4 table: ``activate``, ``close``.
"""

from core.rbac.registry import registry

# "All staff" in the §4 table means every default tenant role except the restricted
# principals (student, guardian), which can never hold a staff permission key.
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

CONFIG_MANAGERS = ("school_owner", "school_admin", "it_admin")
OWNER_ADMIN = ("school_owner", "school_admin")
ACADEMIC_MANAGERS = ("school_admin", "principal")
STRUCTURE_IO = ("school_admin", "it_admin")

registry.register(
    "school.settings.view",
    "View the school profile and academic configuration.",
    ALL_STAFF,
)
registry.register(
    "school.settings.update",
    "Edit the school profile and academic configuration (calendar, timezone, locale, currency).",
    CONFIG_MANAGERS,
)

registry.register("school.campus.view", "List and read campuses.", ALL_STAFF)
registry.register("school.campus.create", "Create a campus.", OWNER_ADMIN)
registry.register("school.campus.update", "Edit a campus.", OWNER_ADMIN)
registry.register("school.campus.delete", "Deactivate or soft-delete a campus.", OWNER_ADMIN)

registry.register("school.department.view", "List and read departments.", ALL_STAFF)
registry.register("school.department.create", "Create a department.", ACADEMIC_MANAGERS)
registry.register("school.department.update", "Edit a department.", ACADEMIC_MANAGERS)
registry.register(
    "school.department.delete", "Deactivate or soft-delete a department.", ACADEMIC_MANAGERS
)

registry.register(
    "school.academic-session.view", "List and read academic sessions and terms.", ALL_STAFF
)
registry.register(
    "school.academic-session.create",
    "Create an academic session or term, including cloning next year's session.",
    ("school_admin",),
)
registry.register(
    "school.academic-session.update", "Edit an academic session or term.", ("school_admin",)
)
registry.register(
    "school.academic-session.activate",
    "Activate a session after the structure completeness check (audited).",
    OWNER_ADMIN,
)
registry.register(
    "school.academic-session.close",
    "Close a session, making it read-only for transactional modules (audited).",
    OWNER_ADMIN,
)

registry.register("school.class.view", "List and read classes (grade levels).", ALL_STAFF)
registry.register("school.class.create", "Create a class.", ACADEMIC_MANAGERS)
registry.register("school.class.update", "Edit a class.", ACADEMIC_MANAGERS)
registry.register(
    "school.class.delete", "Deactivate or soft-delete a class.", ACADEMIC_MANAGERS
)

registry.register("school.section.view", "List and read sections.", ALL_STAFF)
registry.register("school.section.create", "Create a section.", ACADEMIC_MANAGERS)
registry.register("school.section.update", "Edit a section.", ACADEMIC_MANAGERS)
registry.register(
    "school.section.delete", "Deactivate or soft-delete a section.", ACADEMIC_MANAGERS
)

registry.register(
    "school.subject.view", "List and read subjects and their class mappings.", ALL_STAFF
)
registry.register(
    "school.subject.create", "Create a subject or map one to a class.", ACADEMIC_MANAGERS
)
registry.register(
    "school.subject.update", "Edit a subject or its class mapping.", ACADEMIC_MANAGERS
)
registry.register(
    "school.subject.delete",
    "Deactivate or soft-delete a subject or its class mapping.",
    ACADEMIC_MANAGERS,
)

registry.register("school.house.view", "List and read houses.", ALL_STAFF)
registry.register("school.house.create", "Create a house.", OWNER_ADMIN)
registry.register("school.house.update", "Edit a house.", OWNER_ADMIN)
registry.register("school.house.delete", "Deactivate or soft-delete a house.", OWNER_ADMIN)

registry.register(
    "school.structure.import", "Bulk import structure from CSV/Excel.", STRUCTURE_IO
)
registry.register(
    "school.structure.export", "Bulk export structure to CSV/Excel.", STRUCTURE_IO
)
