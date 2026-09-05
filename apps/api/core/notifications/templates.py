"""Platform default templates, declared in code.

notifications.md §2 describes two layers: a **platform default** template per
notification type per channel, and optional **tenant overrides** editable from the
dashboard. Only the first layer lives here. The override table
(`notification_templates`) belongs to the communication module, and until it ships
every tenant renders the platform default — which is the correct fallback the doc
already specifies, not a placeholder.

Two rules from §2 that this module enforces rather than documents:

1. **Merge variables are whitelisted per template.** A body may only reference
   names the template declared. That matters far more once tenants can edit bodies,
   but enforcing it now means the contract is already true when they can — and it
   turns a typo'd variable into a loud error at render time instead of an empty
   string in a parent's SMS.
2. **Rendering produces plain text; escaping belongs to the adapter.** This used
   to HTML-escape for the EMAIL channel, which was wrong twice over: the stored
   `Notification.title`/`body` are rendered once from the in-app template and
   reused by every channel, so the escaping never ran where it was meant to —
   and where it did run, `EmailAdapter` built the *plain-text* MIME part from the
   escaped string, so "Smith & Sons" reached plain-text clients as
   "Smith &amp; Sons". `adapters.EmailAdapter` now escapes when it builds the
   HTML alternative and nowhere else, which is what "adapters own
   provider-specific formatting" (§1) already said.

   The renderer is still deliberately not Django's template engine: bodies become
   tenant-editable input in Tier 4, and handing untrusted input to a full
   template engine is how server-side template injection happens. A literal
   `{{ name }}` substitution over a declared variable set cannot execute anything.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from core.notifications.models import NotificationChannel

# `{{ variable }}` / `{{variable}}` — dots allowed so a template can read
# `student.first_name` from a flattened context.
_PLACEHOLDER = re.compile(r"\{\{\s*([a-z0-9_.]+)\s*\}\}", re.IGNORECASE)

# Everything except email renders as plain text; only email gets HTML escaping.
PLAIN_TEXT_CHANNELS = frozenset(
    {
        NotificationChannel.SMS,
        NotificationChannel.WHATSAPP,
        NotificationChannel.IN_APP,
        NotificationChannel.PUSH,
    }
)

# SMS and WhatsApp have no title concept at all. In-app and push do (the in-app one
# is `notifications.title`), so "plain text" and "has no subject" are not the same set.
SUBJECTLESS_CHANNELS = frozenset({NotificationChannel.SMS, NotificationChannel.WHATSAPP})


class TemplateError(Exception):
    """A template is malformed, or a render was given the wrong variables."""


@dataclass(frozen=True)
class NotificationTemplate:
    """One (code, channel) render target.

    `subject` is None for channels that have no title concept (SMS, WhatsApp).
    """

    code: str
    channel: str
    subject: str | None
    body: str
    variables: frozenset[str] = field(default_factory=frozenset)

    def render(self, context: dict[str, object]) -> tuple[str, str]:
        """Return `(subject, body)` with placeholders filled.

        Raises `TemplateError` on a missing variable rather than substituting an
        empty string: a blank name in "Dear {{ guardian.name }}" reaching a real
        parent is worse than the send failing loudly.
        """
        subject = _substitute(self.subject or "", context, self.variables, self.channel)
        body = _substitute(self.body, context, self.variables, self.channel)
        return subject, body


def _substitute(
    text: str, context: dict[str, object], allowed: frozenset[str], channel: str
) -> str:
    def replace(match: re.Match[str]) -> str:
        name = match.group(1)
        if name not in allowed:
            raise TemplateError(f"Template variable {name!r} is not declared for this template.")
        if name not in context:
            raise TemplateError(f"Template variable {name!r} was not supplied.")
        return str(context[name])

    return _PLACEHOLDER.sub(replace, text)


class TemplateRegistry:
    """Platform defaults, keyed by `(code, channel)`.

    Mirrors core/rbac/registry.py and core/tenancy/features.py: modules declare
    into it at app-ready time, and nothing is stored in the database.
    """

    def __init__(self) -> None:
        self._templates: dict[tuple[str, str], NotificationTemplate] = {}

    def register(
        self,
        code: str,
        *,
        channel: str,
        body: str,
        variables: set[str] | frozenset[str],
        subject: str | None = None,
    ) -> NotificationTemplate:
        if (code, channel) in self._templates:
            raise ValueError(f"Duplicate template {code!r} for channel {channel!r}")
        if channel not in NotificationChannel.values:
            raise ValueError(f"Unknown channel {channel!r} for template {code!r}")
        if channel in SUBJECTLESS_CHANNELS and subject is not None:
            raise ValueError(f"Channel {channel!r} has no subject; template {code!r} set one")
        if channel not in SUBJECTLESS_CHANNELS and not subject:
            raise ValueError(f"Channel {channel!r} needs a subject; template {code!r} has none")

        template = NotificationTemplate(
            code=code,
            channel=channel,
            subject=subject,
            body=body,
            variables=frozenset(variables),
        )
        _assert_placeholders_declared(template)
        self._templates[(code, channel)] = template
        return template

    def get(self, code: str, channel: str) -> NotificationTemplate | None:
        return self._templates.get((code, channel))

    def channels_for(self, code: str) -> set[str]:
        return {ch for (registered, ch) in self._templates if registered == code}

    def all(self) -> list[NotificationTemplate]:
        return sorted(self._templates.values(), key=lambda t: (t.code, t.channel))

    def codes(self) -> set[str]:
        return {code for (code, _) in self._templates}


def _assert_placeholders_declared(template: NotificationTemplate) -> None:
    """Catch an undeclared placeholder at import time, not at send time.

    A template registered with `{{ student.name }}` but no such declared variable
    would otherwise only fail the first time a real absence alert tried to render.
    """
    used = {
        match.group(1)
        for text in (template.subject or "", template.body)
        for match in _PLACEHOLDER.finditer(text)
    }
    undeclared = used - template.variables
    if undeclared:
        raise ValueError(
            f"Template {template.code!r} ({template.channel}) uses undeclared "
            f"variables: {', '.join(sorted(undeclared))}"
        )


registry = TemplateRegistry()


def load_module_notifications() -> None:
    """Import every installed app's ``notifications`` module so it self-registers."""
    from django.apps import apps
    from django.utils.module_loading import module_has_submodule

    for config in apps.get_app_configs():
        if module_has_submodule(config.module, "notifications"):
            __import__(f"{config.name}.notifications")
