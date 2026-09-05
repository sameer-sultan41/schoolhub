"""The trigger catalog — events to notifications.

notifications.md §3 states the rule this module exists to enforce: **modules never
send notifications directly.** A module emits a domain event at a service-layer
commit point; the catalog owns the mapping from that event to its category,
priority lane, channels and template. That indirection is what lets communication
(Tier 4) add tenant-configurable trigger toggles later without every module
growing its own send call.

Each module doc's §12 Notifications table *is* the content of this catalog. A
module declares its rows in its own `notifications.py`, next to the templates they
render.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from core.notifications.models import (
    NotificationCategory,
    NotificationChannel,
    NotificationPriority,
)

logger = logging.getLogger(__name__)

# The floor from notifications.md §4: in-app is internal, always available, and
# carries the reliability guarantee, so it can never be configured away.
MANDATORY_CHANNEL = NotificationChannel.IN_APP


@dataclass(frozen=True)
class Trigger:
    event_key: str
    template_code: str
    category: str
    priority: str
    channels: frozenset[str]
    variables: frozenset[str]
    description: str = ""


class TriggerCatalog:
    def __init__(self) -> None:
        self._triggers: dict[str, Trigger] = {}

    def register(
        self,
        event_key: str,
        *,
        template_code: str,
        category: str,
        variables: set[str] | frozenset[str],
        channels: set[str] | frozenset[str] | None = None,
        priority: str = NotificationPriority.NORMAL,
        description: str = "",
    ) -> Trigger:
        """Declare one event.

        `channels` names the *default* channels; in-app is always added, because
        §4's mandatory floor is not a default a tenant may drop below.
        """
        if event_key in self._triggers:
            raise ValueError(f"Duplicate notification trigger {event_key!r}")
        if event_key.count(".") != 1 or not all(part for part in event_key.split(".")):
            raise ValueError(f"Trigger {event_key!r} must be '<module>.<event-name>'")
        if category not in NotificationCategory.values:
            raise ValueError(f"Unknown category {category!r} for trigger {event_key!r}")
        if priority not in NotificationPriority.values:
            raise ValueError(f"Unknown priority {priority!r} for trigger {event_key!r}")

        resolved = frozenset(channels or set()) | {MANDATORY_CHANNEL}
        unknown = resolved - set(NotificationChannel.values)
        if unknown:
            raise ValueError(f"Unknown channel(s) {sorted(unknown)} for trigger {event_key!r}")

        # A channel can be a valid enum member and still have no adapter. Left
        # unchecked, such a trigger registers silently and then logs `skipped`
        # deliveries forever with nothing at startup to say why — the module doc
        # promises SMS, the code quietly never sends it. Every other registry in
        # core/ validates its declarations at app-ready; this is that check.
        # A warning rather than a raise, because declaring the channel a module
        # doc specifies is correct — it is the missing adapter that is the gap,
        # and it should be visible rather than fatal.
        from core.notifications.adapters import available_channels

        unimplemented = resolved - available_channels()
        if unimplemented:
            logger.warning(
                "trigger %r declares channel(s) with no adapter: %s — deliveries on "
                "those channels will be recorded as skipped until one ships",
                event_key,
                ", ".join(sorted(unimplemented)),
            )

        trigger = Trigger(
            event_key=event_key,
            template_code=template_code,
            category=category,
            priority=priority,
            channels=resolved,
            variables=frozenset(variables),
            description=description,
        )
        self._triggers[event_key] = trigger
        return trigger

    def get(self, event_key: str) -> Trigger | None:
        return self._triggers.get(event_key)

    def all(self) -> list[Trigger]:
        return sorted(self._triggers.values(), key=lambda t: t.event_key)

    def keys(self) -> set[str]:
        return set(self._triggers)

    def __contains__(self, event_key: str) -> bool:
        return event_key in self._triggers


registry = TriggerCatalog()
