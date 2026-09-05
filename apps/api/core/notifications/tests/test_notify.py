"""`notify()` — persist first, enqueue second.

The assertions that matter most are the ones about *not* losing a record: rows
exist before any adapter runs, a skipped channel is recorded with its reason
rather than silently dropped, and no unmasked address is ever stored.
"""

from __future__ import annotations

from django.core import mail
from django.test import TestCase

from apps.school_organization.tests.factories import TenantFactory, UserFactory
from core.notifications.catalog import MANDATORY_CHANNEL, TriggerCatalog
from core.notifications.catalog import registry as catalog
from core.notifications.models import (
    DeliveryLog,
    DeliveryStatus,
    Notification,
    NotificationCategory,
    NotificationChannel,
)
from core.notifications.services import Recipient, UnknownTrigger, mask_address, notify
from core.notifications.templates import TemplateError
from core.notifications.templates import registry as template_registry
from core.tenancy.context import tenant_context

EVENT = "test.event"
CODE = "test.event"
VARIABLES = {"name"}


def _register_test_trigger(*, channels: set[str]) -> None:
    """Register a throwaway trigger + templates into the real registries.

    Registered per test rather than in a fixture module so the shipped catalog
    stays exactly what the modules declare — a test-only trigger leaking into
    `catalog.all()` would quietly weaken the contract test in test_catalog.py.
    """
    catalog.register(
        EVENT,
        template_code=CODE,
        category=NotificationCategory.ATTENDANCE,
        channels=channels,
        variables=VARIABLES,
    )
    template_registry.register(
        CODE,
        channel=NotificationChannel.IN_APP,
        subject="Hi {{ name }}",
        body="Body for {{ name }}",
        variables=VARIABLES,
    )
    if NotificationChannel.EMAIL in channels:
        template_registry.register(
            CODE,
            channel=NotificationChannel.EMAIL,
            subject="Hi {{ name }}",
            body="Body for {{ name }}",
            variables=VARIABLES,
        )


class NotifyTestCase(TestCase):
    """Swaps in fresh registries so a test-only trigger never leaks."""

    channels: set[str] = {NotificationChannel.IN_APP}

    def setUp(self) -> None:
        super().setUp()
        self._saved_catalog = catalog._triggers.copy()  # noqa: SLF001 — module registry
        self._saved_templates = template_registry._templates.copy()  # noqa: SLF001
        _register_test_trigger(channels=self.channels)

        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant, email="parent@example.test")

    def tearDown(self) -> None:
        catalog._triggers = self._saved_catalog  # noqa: SLF001 — restoring a module registry
        template_registry._templates = self._saved_templates  # noqa: SLF001
        super().tearDown()

    def run_notify(self, *, deliver: bool = False, **kwargs):
        """Call notify(), optionally running the on_commit dispatch.

        `TestCase` wraps every test in a transaction it rolls back, so
        `transaction.on_commit` never fires by itself — without
        `captureOnCommitCallbacks` a delivery assertion would silently test
        nothing. Persistence assertions do not need it, which is the point of
        persist-before-enqueue.
        """
        with self.captureOnCommitCallbacks(execute=deliver), tenant_context(self.tenant.id):
            return notify(
                EVENT,
                tenant_id=self.tenant.pk,
                recipients=[Recipient(user_id=self.user.pk)],
                context={"name": "Ayesha"},
                **kwargs,
            )


class InAppOnlyTests(NotifyTestCase):
    def test_persists_one_notification_per_recipient(self) -> None:
        created = self.run_notify()

        self.assertEqual(len(created), 1)
        with tenant_context(self.tenant.id):
            row = Notification.objects.get(pk=created[0].pk)
        self.assertEqual(row.user_id, self.user.pk)
        self.assertEqual(row.event_key, EVENT)
        self.assertEqual(row.category, NotificationCategory.ATTENDANCE)
        self.assertEqual(row.title, "Hi Ayesha")
        self.assertEqual(row.body, "Body for Ayesha")

    def test_writes_a_delivery_row_for_the_mandatory_channel(self) -> None:
        created = self.run_notify()

        with tenant_context(self.tenant.id):
            deliveries = list(DeliveryLog.objects.filter(notification=created[0]))

        self.assertEqual([d.channel for d in deliveries], [MANDATORY_CHANNEL])

    def test_records_the_source_for_a_deep_link(self) -> None:
        created = self.run_notify(source_type="student", source_id=self.user.pk)

        with tenant_context(self.tenant.id):
            row = Notification.objects.get(pk=created[0].pk)

        self.assertEqual(row.source_type, "student")
        self.assertEqual(row.source_id, self.user.pk)

    def test_an_unknown_event_is_rejected(self) -> None:
        with tenant_context(self.tenant.id), self.assertRaises(UnknownTrigger):
            notify(
                "nope.nothing",
                tenant_id=self.tenant.pk,
                recipients=[Recipient(user_id=self.user.pk)],
                context={},
            )

    def test_a_missing_context_variable_is_rejected_before_anything_persists(self) -> None:
        with tenant_context(self.tenant.id), self.assertRaises(TemplateError):
            notify(
                EVENT,
                tenant_id=self.tenant.pk,
                recipients=[Recipient(user_id=self.user.pk)],
                context={},
            )

        with tenant_context(self.tenant.id):
            self.assertEqual(Notification.objects.count(), 0)

    def test_no_recipients_persists_nothing(self) -> None:
        with tenant_context(self.tenant.id):
            created = notify(
                EVENT,
                tenant_id=self.tenant.pk,
                recipients=[],
                context={"name": "Ayesha"},
            )

        self.assertEqual(created, [])


class EmailChannelTests(NotifyTestCase):
    channels = {NotificationChannel.IN_APP, NotificationChannel.EMAIL}

    def test_queues_email_when_the_recipient_has_an_address(self) -> None:
        created = self.run_notify()

        with tenant_context(self.tenant.id):
            email_row = DeliveryLog.objects.get(
                notification=created[0], channel=NotificationChannel.EMAIL
            )

        self.assertEqual(email_row.status, DeliveryStatus.QUEUED)
        self.assertIsNone(email_row.error_message)

    def test_skips_with_a_reason_when_the_recipient_has_no_address(self) -> None:
        # `skipped` with a reason, never an absent row — notifications.md §6.
        self.user.email = ""
        self.user.save(update_fields=["email"])

        created = self.run_notify()

        with tenant_context(self.tenant.id):
            email_row = DeliveryLog.objects.get(
                notification=created[0], channel=NotificationChannel.EMAIL
            )

        self.assertEqual(email_row.status, DeliveryStatus.SKIPPED)
        self.assertIn("no email address", (email_row.error_message or "").lower())

    def test_never_stores_an_unmasked_address(self) -> None:
        created = self.run_notify()

        with tenant_context(self.tenant.id):
            addresses = list(
                DeliveryLog.objects.filter(notification=created[0]).values_list(
                    "recipient_address", flat=True
                )
            )

        self.assertNotIn("parent@example.test", addresses)

    def test_delivers_the_email_end_to_end(self) -> None:
        mail.outbox.clear()

        created = self.run_notify(deliver=True)

        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].subject, "Hi Ayesha")
        self.assertEqual(mail.outbox[0].to, ["parent@example.test"])

        with tenant_context(self.tenant.id):
            email_row = DeliveryLog.objects.get(
                notification=created[0], channel=NotificationChannel.EMAIL
            )
            in_app_row = DeliveryLog.objects.get(
                notification=created[0], channel=NotificationChannel.IN_APP
            )

        self.assertEqual(email_row.status, DeliveryStatus.SENT)
        self.assertEqual(email_row.attempts, 1)
        # In-app has no provider hop, so it is delivered the instant it is sent.
        self.assertEqual(in_app_row.status, DeliveryStatus.DELIVERED)
        self.assertIsNotNone(in_app_row.delivered_at)


class UnavailableChannelTests(NotifyTestCase):
    channels = {NotificationChannel.IN_APP, NotificationChannel.SMS}

    def test_a_channel_with_no_adapter_is_skipped_with_a_reason(self) -> None:
        created = self.run_notify()

        with tenant_context(self.tenant.id):
            sms_row = DeliveryLog.objects.get(
                notification=created[0], channel=NotificationChannel.SMS
            )

        self.assertEqual(sms_row.status, DeliveryStatus.SKIPPED)
        self.assertIn("no adapter", (sms_row.error_message or "").lower())


class MaskAddressTests(TestCase):
    def test_keeps_enough_of_an_email_to_correlate_a_support_case(self) -> None:
        self.assertEqual(mask_address("parent@example.test"), "pa****@example.test")

    def test_keeps_only_the_last_four_of_a_phone_number(self) -> None:
        self.assertEqual(mask_address("+923001234567"), "*********4567")

    def test_an_empty_address_masks_to_empty(self) -> None:
        self.assertEqual(mask_address(""), "")


class TriggerCatalogTests(TestCase):
    def test_the_mandatory_channel_is_always_added(self) -> None:
        # §4's floor is not a default a caller may drop below.
        local = TriggerCatalog()
        trigger = local.register(
            "demo.thing",
            template_code="demo.thing",
            category=NotificationCategory.FEES,
            channels={NotificationChannel.EMAIL},
            variables=set(),
        )

        self.assertIn(MANDATORY_CHANNEL, trigger.channels)

    def test_rejects_a_malformed_event_key(self) -> None:
        local = TriggerCatalog()
        for key in ("single", "too.many.dots", ".leading"):
            with self.subTest(key=key), self.assertRaises(ValueError):
                local.register(
                    key, template_code="x", category=NotificationCategory.FEES, variables=set()
                )

    def test_rejects_an_unknown_category_channel_or_priority(self) -> None:
        local = TriggerCatalog()
        with self.assertRaises(ValueError):
            local.register("demo.a", template_code="x", category="nope", variables=set())
        with self.assertRaises(ValueError):
            local.register(
                "demo.b",
                template_code="x",
                category=NotificationCategory.FEES,
                channels={"carrier-pigeon"},
                variables=set(),
            )
        with self.assertRaises(ValueError):
            local.register(
                "demo.c",
                template_code="x",
                category=NotificationCategory.FEES,
                priority="urgent-ish",
                variables=set(),
            )


class ShippedCatalogTests(TestCase):
    def test_every_trigger_has_a_template_for_every_channel_it_declares(self) -> None:
        """A trigger promising a channel it cannot render is a silent under-delivery.

        Caught here rather than at send time, where it would show up as a
        `skipped` row nobody reads.
        """
        for trigger in catalog.all():
            for channel in trigger.channels:
                with self.subTest(event=trigger.event_key, channel=channel):
                    self.assertIsNotNone(
                        template_registry.get(trigger.template_code, channel),
                        f"{trigger.event_key} declares {channel} but has no template",
                    )

    def test_every_trigger_declares_the_variables_its_templates_use(self) -> None:
        for trigger in catalog.all():
            for channel in trigger.channels:
                template = template_registry.get(trigger.template_code, channel)
                if template is None:
                    continue
                with self.subTest(event=trigger.event_key, channel=channel):
                    self.assertEqual(
                        template.variables - trigger.variables,
                        set(),
                        f"{trigger.event_key} template needs variables the trigger omits",
                    )
