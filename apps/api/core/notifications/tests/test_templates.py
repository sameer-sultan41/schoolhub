"""Template rendering and the whitelist that guards it."""

from __future__ import annotations

from django.test import SimpleTestCase

from core.notifications.models import NotificationChannel
from core.notifications.templates import (
    TemplateError,
    TemplateRegistry,
    registry,
)


def _registry_with(**kwargs) -> TemplateRegistry:
    local = TemplateRegistry()
    local.register("demo.thing", **kwargs)
    return local


class RenderTests(SimpleTestCase):
    def test_substitutes_declared_variables(self) -> None:
        local = _registry_with(
            channel=NotificationChannel.IN_APP,
            subject="Hello {{ name }}",
            body="Your child {{ student.first_name }} was absent.",
            variables={"name", "student.first_name"},
        )
        template = local.get("demo.thing", NotificationChannel.IN_APP)
        assert template is not None

        subject, body = template.render({"name": "Ayesha", "student.first_name": "Bilal"})

        self.assertEqual(subject, "Hello Ayesha")
        self.assertEqual(body, "Your child Bilal was absent.")

    def test_tolerates_whitespace_inside_the_braces(self) -> None:
        local = _registry_with(
            channel=NotificationChannel.IN_APP,
            subject="Hi",
            body="{{name}} and {{  name  }}",
            variables={"name"},
        )
        template = local.get("demo.thing", NotificationChannel.IN_APP)
        assert template is not None

        _, body = template.render({"name": "X"})

        self.assertEqual(body, "X and X")

    def test_a_missing_value_fails_loudly_rather_than_rendering_a_blank(self) -> None:
        # "Dear {{ guardian.name }}," arriving at a real parent as "Dear ," is worse
        # than the send failing, so a missing value must raise.
        local = _registry_with(
            channel=NotificationChannel.IN_APP,
            subject="Hi",
            body="Dear {{ name }}",
            variables={"name"},
        )
        template = local.get("demo.thing", NotificationChannel.IN_APP)
        assert template is not None

        with self.assertRaises(TemplateError):
            template.render({})

    def test_email_bodies_are_html_escaped(self) -> None:
        local = _registry_with(
            channel=NotificationChannel.EMAIL,
            subject="Hi",
            body="Name: {{ name }}",
            variables={"name"},
        )
        template = local.get("demo.thing", NotificationChannel.EMAIL)
        assert template is not None

        _, body = template.render({"name": "<script>alert(1)</script>"})

        self.assertNotIn("<script>", body)
        self.assertIn("&lt;script&gt;", body)

    def test_plain_text_channels_are_not_escaped(self) -> None:
        local = _registry_with(
            channel=NotificationChannel.IN_APP,
            subject="Hi",
            body="{{ name }}",
            variables={"name"},
        )
        template = local.get("demo.thing", NotificationChannel.IN_APP)
        assert template is not None

        _, body = template.render({"name": "Ali & Sons"})

        self.assertEqual(body, "Ali & Sons")

    def test_a_context_key_outside_the_whitelist_is_ignored_not_injected(self) -> None:
        """Extra context cannot introduce placeholders the template never declared."""
        local = _registry_with(
            channel=NotificationChannel.IN_APP,
            subject="Hi",
            body="Just {{ name }}",
            variables={"name"},
        )
        template = local.get("demo.thing", NotificationChannel.IN_APP)
        assert template is not None

        _, body = template.render({"name": "X", "secret": "should not appear"})

        self.assertEqual(body, "Just X")


class RegistrationTests(SimpleTestCase):
    def test_an_undeclared_placeholder_is_rejected_at_registration(self) -> None:
        # Caught at import time rather than the first time a real absence alert
        # tries to render.
        local = TemplateRegistry()
        with self.assertRaises(ValueError):
            local.register(
                "demo.thing",
                channel=NotificationChannel.IN_APP,
                subject="Hi",
                body="{{ undeclared }}",
                variables={"name"},
            )

    def test_a_duplicate_code_and_channel_is_rejected(self) -> None:
        local = TemplateRegistry()
        local.register(
            "demo.thing",
            channel=NotificationChannel.IN_APP,
            subject="Hi",
            body="x",
            variables=set(),
        )
        with self.assertRaises(ValueError):
            local.register(
                "demo.thing",
                channel=NotificationChannel.IN_APP,
                subject="Hi",
                body="y",
                variables=set(),
            )

    def test_the_same_code_may_register_once_per_channel(self) -> None:
        local = TemplateRegistry()
        for channel in (NotificationChannel.IN_APP, NotificationChannel.EMAIL):
            local.register("demo.thing", channel=channel, subject="Hi", body="x", variables=set())

        self.assertEqual(
            local.channels_for("demo.thing"),
            {NotificationChannel.IN_APP, NotificationChannel.EMAIL},
        )

    def test_sms_may_not_declare_a_subject(self) -> None:
        local = TemplateRegistry()
        with self.assertRaises(ValueError):
            local.register(
                "demo.thing",
                channel=NotificationChannel.SMS,
                subject="nope",
                body="x",
                variables=set(),
            )

    def test_a_subject_bearing_channel_must_have_one(self) -> None:
        local = TemplateRegistry()
        with self.assertRaises(ValueError):
            local.register(
                "demo.thing", channel=NotificationChannel.EMAIL, body="x", variables=set()
            )

    def test_an_unknown_channel_is_rejected(self) -> None:
        local = TemplateRegistry()
        with self.assertRaises(ValueError):
            local.register("demo.thing", channel="carrier-pigeon", body="x", variables=set())


class ShippedTemplateTests(SimpleTestCase):
    def test_the_staff_invite_template_is_registered_for_the_mandatory_channel(self) -> None:
        template = registry.get("staff.invited", NotificationChannel.IN_APP)

        self.assertIsNotNone(template)
