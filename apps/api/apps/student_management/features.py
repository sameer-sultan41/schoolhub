"""Feature flag owned by the student-management module.

Phase-2 definition-of-done item 5: "module wrapped in a server-checked flag,
default off for real tenants." Unlike school-organization (already shipped
before this gate existed), this module is new — it stays off until a tenant is
explicitly onboarded onto it.
"""

from core.tenancy.features import registry

registry.register(
    "module.students",
    "Student management (profiles, guardians, documents, enrollment lifecycle).",
    default_enabled=False,
)
