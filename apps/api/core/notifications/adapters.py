"""Channel adapters — the one place a provider SDK may ever be imported.

notifications.md §1 defines the interface verbatim; this is that Protocol plus the
two adapters the platform needs before communication (Tier 4) ships. Business code
never imports a provider SDK, so providers can be swapped or regionalized per
tenant without touching a module.

SMS, push and WhatsApp are registered but raise `ChannelUnavailable`. That is a
deliberate choice over simply omitting them: a trigger that names `sms` among its
channels then fails loudly at send time with a message naming the module that will
implement it, rather than silently delivering on fewer channels than its module doc
promised — the failure mode `core.files.FileStatus.QUARANTINED` is documented for.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Protocol

from django.conf import settings
from django.core.mail import EmailMultiAlternatives

from core.notifications.models import NotificationChannel

logger = logging.getLogger(__name__)


class ChannelUnavailable(Exception):
    """No working adapter for this channel yet."""


@dataclass(frozen=True)
class RenderedMessage:
    channel: str
    recipient_address: str
    subject: str
    body: str
    template_code: str


@dataclass(frozen=True)
class ProviderReceipt:
    provider: str
    provider_message_id: str | None = None


@dataclass(frozen=True)
class DeliveryUpdate:
    provider_message_id: str
    status: str
    error_message: str | None = None


class ChannelAdapter(Protocol):
    """notifications.md §1."""

    channel: str

    def send(self, message: RenderedMessage) -> ProviderReceipt: ...

    def parse_status_webhook(self, payload: dict) -> DeliveryUpdate: ...


class InAppAdapter:
    """The channel of record (notifications.md §8).

    There is no provider hop: the `Notification` row *is* the delivery, written
    before any adapter runs, so `send` has nothing left to do but confirm. That is
    why in-app is the mandatory floor — it cannot fail for an external reason.
    """

    # Annotated `str`, not `NotificationChannel`: ChannelAdapter is a Protocol and
    # its attributes are invariant, so a narrower type here fails the structural
    # match even though the value is a str subclass.
    channel: str = NotificationChannel.IN_APP

    def send(self, message: RenderedMessage) -> ProviderReceipt:
        return ProviderReceipt(provider="in_app")

    def parse_status_webhook(self, payload: dict) -> DeliveryUpdate:
        raise ChannelUnavailable("The in-app channel has no provider webhooks.")


class EmailAdapter:
    """Django's mail backend, whatever `EMAIL_BACKEND` points at.

    Dev and CI use the console/locmem backends, so nothing leaves the machine. A
    real provider (SES, Postmark) is configured by pointing `EMAIL_BACKEND` at it —
    no code change here, which is the point of the adapter layer.

    Bodies are sent as both plain text and HTML: the renderer HTML-escapes email
    bodies (templates.py), so the text alternative is the escaped source rather
    than a second render, and a client that cannot show HTML still gets the words.
    """

    channel: str = NotificationChannel.EMAIL

    def send(self, message: RenderedMessage) -> ProviderReceipt:
        from_email = getattr(settings, "DEFAULT_FROM_EMAIL", None)
        mail = EmailMultiAlternatives(
            subject=message.subject,
            body=message.body,
            from_email=from_email,
            to=[message.recipient_address],
        )
        mail.attach_alternative(f"<p>{message.body}</p>", "text/html")
        mail.send(fail_silently=False)
        return ProviderReceipt(provider=settings.EMAIL_BACKEND.rsplit(".", 1)[-1])

    def parse_status_webhook(self, payload: dict) -> DeliveryUpdate:
        # Bounce/complaint webhooks are communication-module scope (§6).
        raise ChannelUnavailable("Email status webhooks arrive with the communication module.")


class _NotImplementedAdapter:
    """A channel whose module has not landed. Named in the error, not silent."""

    def __init__(self, channel: str, owner: str) -> None:
        self.channel = channel
        self._owner = owner

    def send(self, message: RenderedMessage) -> ProviderReceipt:
        raise ChannelUnavailable(
            f"The {self.channel} channel has no adapter yet — it ships with {self._owner}."
        )

    def parse_status_webhook(self, payload: dict) -> DeliveryUpdate:
        raise ChannelUnavailable(
            f"The {self.channel} channel has no adapter yet — it ships with {self._owner}."
        )


_ADAPTERS: dict[str, ChannelAdapter] = {
    NotificationChannel.IN_APP: InAppAdapter(),
    NotificationChannel.EMAIL: EmailAdapter(),
    NotificationChannel.SMS: _NotImplementedAdapter(
        NotificationChannel.SMS, "the communication module (Tier 4)"
    ),
    NotificationChannel.PUSH: _NotImplementedAdapter(
        NotificationChannel.PUSH, "the communication module (Tier 4)"
    ),
    NotificationChannel.WHATSAPP: _NotImplementedAdapter(
        NotificationChannel.WHATSAPP, "the communication module (Tier 4)"
    ),
}


def get_adapter(channel: str) -> ChannelAdapter:
    adapter = _ADAPTERS.get(channel)
    if adapter is None:
        raise ChannelUnavailable(f"Unknown notification channel {channel!r}.")
    return adapter


def available_channels() -> set[str]:
    """Channels with a real adapter — what `notify()` will actually attempt."""
    return {
        channel
        for channel, adapter in _ADAPTERS.items()
        if not isinstance(adapter, _NotImplementedAdapter)
    }
