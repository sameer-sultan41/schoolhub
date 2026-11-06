"""409s an account invite can refuse with (ADR-0033).

Each is its own `Conflict` subclass because `envelope_exception_handler` reads the code
from `default_code`, the same way `AudienceChanged` carries `audience_changed`. Staff and
student_management raise them, so they live beside the invitation services in `core`.
"""

from __future__ import annotations

from core.api.exceptions import Conflict


class EmailInUse(Conflict):
    default_detail = "This email belongs to another account. Use a different address."
    default_code = "email_in_use"


class AlreadyActive(Conflict):
    default_detail = "This person already has an active account."
    default_code = "already_active"


class PortalDisabled(Conflict):
    default_detail = "The parent portal is not enabled for your school."
    default_code = "portal_disabled"


class NotEligible(Conflict):
    default_detail = "This person cannot be given portal access right now."
    default_code = "not_eligible"
