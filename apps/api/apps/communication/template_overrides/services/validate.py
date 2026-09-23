"""Write-time validation for a tenant's template override."""

from __future__ import annotations

from core.api.exceptions import DomainRuleViolation
from core.notifications.templates import SUBJECTLESS_CHANNELS, used_placeholders
from core.notifications.templates import registry as platform_templates


def assert_override_is_valid(*, code: str, channel: str, subject: str | None, body: str) -> None:
    """A tenant override may only reference variables the platform template declared,
    and must match its channel's subject shape.

    Reuses `core.notifications.templates.used_placeholders` — the same
    extraction `_assert_placeholders_declared` runs at registration — because an
    editor's proposed text is checked against a *different* template's (the
    platform default's) declared set, so that function's own check (which reads
    a `NotificationTemplate` instance's own `.variables`) does not apply as-is.
    Refuses if the platform itself has no such (code, channel) at all: an
    override cannot exist for a trigger nothing declares.

    The subject-shape check mirrors `TemplateRegistry.register()`'s own two
    directions for a platform template: SMS/WhatsApp have no title concept and
    must not carry one, and every other channel must. Without this a tenant
    could save an EMAIL/IN_APP override with an empty subject — a notification
    with no title — or an SMS override whose subject silently never renders.
    """
    platform = platform_templates.get(code, channel)
    if platform is None:
        raise DomainRuleViolation(
            f"No platform template exists for ({code!r}, {channel!r}) to override.",
            meta={"code": code, "channel": channel},
        )

    if channel in SUBJECTLESS_CHANNELS and subject:
        raise DomainRuleViolation(
            f"Channel {channel!r} has no subject; this override set one.",
            meta={"channel": channel},
        )
    if channel not in SUBJECTLESS_CHANNELS and not subject:
        raise DomainRuleViolation(
            f"Channel {channel!r} needs a subject.", meta={"channel": channel}
        )

    used = used_placeholders(subject or "", body)
    undeclared = used - platform.variables
    if undeclared:
        raise DomainRuleViolation(
            f"This template uses variables the platform template does not declare: "
            f"{', '.join(sorted(undeclared))}.",
            meta={"undeclared_variables": sorted(undeclared)},
        )
