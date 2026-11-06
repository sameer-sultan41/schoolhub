"""Tenant role slugs shared across apps, declared once.

Source: docs/00-overview/users-and-roles.md §3. Platform roles are not tenant roles and
are deliberately absent.
"""

# Restricted principals: a student or a guardian reads their own records only.
PORTAL_ROLES = ("student", "guardian")

# Every tenant role, so a key meant for "any signed-in member of a school" has one list.
ALL_TENANT_ROLES = (
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
    *PORTAL_ROLES,
)
