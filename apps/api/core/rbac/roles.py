"""Role slugs shared across apps, declared once.

Source: docs/00-overview/users-and-roles.md §2 (platform) and §3 (tenant). A platform role
is never a tenant role: it holds platform-scope keys only, and only a platform user may hold
it (ADR-0036).
"""

# The platform console's operators (platform-admin.md §3).
PLATFORM_ROLES = ("platform_super_admin", "platform_support")

# Holds every tenant-scope key rather than a registry list (users-and-roles.md §3).
SCHOOL_OWNER = "school_owner"

# Restricted principals: a student or a guardian reads their own records only.
PORTAL_ROLES = ("student", "guardian")

# Every tenant role, so a key meant for "any signed-in member of a school" has one list.
ALL_TENANT_ROLES = (
    SCHOOL_OWNER,
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
