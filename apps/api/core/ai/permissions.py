"""Permission keys owned by the AI gateway (ai-governance.md §9).

Each feature's own endpoint carries its owning module's key (``fees.report.summarize``);
these two cover what the gateway itself serves.
"""

from core.rbac.registry import registry
from core.rbac.roles import ALL_TENANT_ROLES, PORTAL_ROLES

#: Every staff role: feedback is open to anyone who can be shown an AI output.
ALL_STAFF = tuple(role for role in ALL_TENANT_ROLES if role not in PORTAL_ROLES)

registry.register(
    "ai.usage.view",
    "See the school's AI token usage against its budget (governance §9: owner and IT admin).",
    ("school_owner", "it_admin"),
)
registry.register(
    "ai.feedback.create",
    "Rate an AI output you were shown, thumbs up or down (own requests only).",
    ALL_STAFF,
)
