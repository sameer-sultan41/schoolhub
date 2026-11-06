"""`preview_broadcast` — who a broadcast would reach right now, and on which channels.

The send (`dispatch.py`) resolves the audience again with the same functions
and compares, so the two can never disagree about what "the audience" means.
"""

from __future__ import annotations

import hashlib
import uuid

from apps.communication.audience import assert_audience_is_nonempty, resolve_audience
from apps.communication.notifications import EMERGENCY_BROADCAST_TRIGGER
from core.notifications.adapters import available_channels

EMPTY_BROADCAST_AUDIENCE_MESSAGE = (
    "This audience resolves to zero recipients. Broaden the targeting before broadcasting."
)


def resolve_recipients(
    *,
    tenant_id: uuid.UUID,
    audience_type: str,
    audience_filter: dict,
    campus_id: uuid.UUID | None,
) -> list[uuid.UUID]:
    """The audience's user ids, sorted by their string form; an empty audience is a 422."""
    recipients = resolve_audience(
        audience_type=audience_type,
        audience_filter=audience_filter,
        tenant_id=tenant_id,
        campus_id=campus_id,
    )
    assert_audience_is_nonempty(recipients, message=EMPTY_BROADCAST_AUDIENCE_MESSAGE)
    return sorted(set(recipients), key=str)


def audience_digest(recipient_ids: list[uuid.UUID]) -> str:
    """sha256 hex of the sorted recipient ids joined by ','.

    The count alone misses one recipient leaving while another joins; the digest
    does not.
    """
    joined = ",".join(sorted(str(pk) for pk in recipient_ids))
    return hashlib.sha256(joined.encode()).hexdigest()


def broadcast_channels() -> tuple[list[str], list[str]]:
    """(channels with an adapter, declared channels without one), each sorted."""
    declared = set(EMERGENCY_BROADCAST_TRIGGER.channels)
    available = available_channels()
    return sorted(declared & available), sorted(declared - available)


def preview_broadcast(
    *,
    tenant_id: uuid.UUID,
    audience_type: str,
    audience_filter: dict,
    campus_id: uuid.UUID | None,
) -> dict:
    recipients = resolve_recipients(
        tenant_id=tenant_id,
        audience_type=audience_type,
        audience_filter=audience_filter,
        campus_id=campus_id,
    )
    channels, unavailable_channels = broadcast_channels()
    return {
        "recipient_count": len(recipients),
        "audience_digest": audience_digest(recipients),
        "channels": channels,
        "unavailable_channels": unavailable_channels,
    }
