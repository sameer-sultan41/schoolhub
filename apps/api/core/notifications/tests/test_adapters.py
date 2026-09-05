"""Channel adapters — the only place a provider SDK may be imported."""

from __future__ import annotations

from django.core import mail
from django.test import SimpleTestCase

from core.notifications.adapters import (
    ChannelUnavailable,
    EmailAdapter,
    InAppAdapter,
    RenderedMessage,
    available_channels,
    get_adapter,
)
from core.notifications.models import NotificationChannel


def _message(channel: str, address: str = "parent@example.test") -> RenderedMessage:
    return RenderedMessage(
        channel=channel,
        recipient_address=address,
        subject="Subject",
        body="Body",
        template_code="test.event",
    )


class AdapterRegistryTests(SimpleTestCase):
    def test_only_in_app_and_email_are_available_today(self) -> None:
        self.assertEqual(
            available_channels(), {NotificationChannel.IN_APP, NotificationChannel.EMAIL}
        )

    def test_an_unknown_channel_raises(self) -> None:
        with self.assertRaises(ChannelUnavailable):
            get_adapter("carrier-pigeon")

    def test_an_unimplemented_channel_names_the_module_that_will_ship_it(self) -> None:
        # Registered-but-raising rather than absent, so a trigger promising SMS
        # fails loudly instead of quietly delivering on fewer channels than its
        # module doc says it does.
        for channel in (
            NotificationChannel.SMS,
            NotificationChannel.PUSH,
            NotificationChannel.WHATSAPP,
        ):
            with self.subTest(channel=channel):
                adapter = get_adapter(channel)
                with self.assertRaises(ChannelUnavailable) as caught:
                    adapter.send(_message(channel))
                self.assertIn("communication module", str(caught.exception))

                with self.assertRaises(ChannelUnavailable):
                    adapter.parse_status_webhook({})


class InAppAdapterTests(SimpleTestCase):
    def test_send_is_a_confirmation_because_the_row_is_the_delivery(self) -> None:
        receipt = InAppAdapter().send(_message(NotificationChannel.IN_APP))

        self.assertEqual(receipt.provider, "in_app")
        self.assertIsNone(receipt.provider_message_id)

    def test_it_has_no_provider_webhooks(self) -> None:
        with self.assertRaises(ChannelUnavailable):
            InAppAdapter().parse_status_webhook({})


class EmailAdapterTests(SimpleTestCase):
    def setUp(self) -> None:
        super().setUp()
        mail.outbox.clear()

    def test_sends_through_whatever_email_backend_is_configured(self) -> None:
        receipt = EmailAdapter().send(_message(NotificationChannel.EMAIL))

        self.assertEqual(len(mail.outbox), 1)
        sent = mail.outbox[0]
        self.assertEqual(sent.subject, "Subject")
        self.assertEqual(sent.to, ["parent@example.test"])
        self.assertTrue(receipt.provider)

    def test_attaches_an_html_alternative(self) -> None:
        EmailAdapter().send(_message(NotificationChannel.EMAIL))

        alternatives = mail.outbox[0].alternatives
        self.assertEqual(len(alternatives), 1)
        self.assertEqual(alternatives[0][1], "text/html")

    def test_bounce_webhooks_are_not_wired_up_yet(self) -> None:
        with self.assertRaises(ChannelUnavailable):
            EmailAdapter().parse_status_webhook({})
