"""Feature flag owned by the staff-management module.

Phase-2 definition-of-done item 5: "module wrapped in a server-checked flag,
default off for real tenants." Same convention as student-management.
"""

from core.tenancy.features import registry

registry.register(
    "module.staff",
    "Staff management (profiles, designations, qualifications, documents).",
    default_enabled=False,
)
