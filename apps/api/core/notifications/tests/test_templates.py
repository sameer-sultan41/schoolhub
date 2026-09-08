"""Template rendering and the whitelist that guards it."""

from __future__ import annotations

from uuid import uuid4

from django.test import SimpleTestCase

from core.notifications import templates as templates_module
from core.notifications.models import NotificationChannel
from core.notifications.templates import (
    NotificationTemplate,
    TemplateError,
    TemplateRegistry,
    registry,
    resolve,
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

    def test_rendering_never_escapes_regardless_of_channel(self) -> None:
        """Escaping belongs to the adapter, not here.

        Doing it in the renderer was wrong twice: the stored body is rendered
        once from the in-app template and reused by every channel, so it never
        ran where intended — and where it did, EmailAdapter built the plain-text
        MIME part from the escaped string. See adapters.EmailAdapter.
        """
        for channel in (NotificationChannel.EMAIL, NotificationChannel.IN_APP):
            with self.subTest(channel=channel):
                local = _registry_with(
                    channel=channel,
                    subject="Hi",
                    body="Name: {{ name }}",
                    variables={"name"},
                )
                template = local.get("demo.thing", channel)
                assert template is not None

                _, body = template.render({"name": "Ali & <Sons>"})

                self.assertEqual(body, "Name: Ali & <Sons>")

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


class ResolveTests(SimpleTestCase):
    """`resolve()` — the tenant-aware lookup `notify()` calls instead of `registry.get()`.

    Exercises the real module-level `registry`, since `resolve()` has no way to
    take one as a parameter — so every test here registers into it and restores
    it afterward, the same discipline test_notify.py's NotifyTestCase uses.
    """

    CODE = "demo.resolve-target"
    TENANT_ID = uuid4()

    def setUp(self) -> None:
        super().setUp()
        self._saved_templates = registry._templates.copy()  # noqa: SLF001
        self._saved_resolver = templates_module._override_resolver  # noqa: SLF001
        registry.register(
            self.CODE,
            channel=NotificationChannel.IN_APP,
            subject="Platform subject",
            body="Platform body",
            variables=set(),
        )

    def tearDown(self) -> None:
        registry._templates = self._saved_templates  # noqa: SLF001
        templates_module.set_override_resolver(self._saved_resolver)
        super().tearDown()

    def test_resolve_falls_back_to_the_platform_default_with_no_resolver_registered(self) -> None:
        template = resolve(self.CODE, NotificationChannel.IN_APP, tenant_id=self.TENANT_ID)

        self.assertEqual(template.body, "Platform body")

    def test_resolve_prefers_the_registered_resolvers_result_when_it_returns_one(self) -> None:
        override = NotificationTemplate(
            code=self.CODE,
            channel=NotificationChannel.IN_APP,
            subject="Tenant subject",
            body="Tenant body",
            variables=frozenset(),
        )
        templates_module.set_override_resolver(lambda code, channel, locale, tenant_id: override)

        template = resolve(self.CODE, NotificationChannel.IN_APP, tenant_id=self.TENANT_ID)

        self.assertIs(template, override)

    def test_resolve_falls_back_to_platform_default_when_the_resolver_returns_none(self) -> None:
        templates_module.set_override_resolver(lambda code, channel, locale, tenant_id: None)

        template = resolve(self.CODE, NotificationChannel.IN_APP, tenant_id=self.TENANT_ID)

        self.assertEqual(template.body, "Platform body")

    def test_resolve_of_an_unregistered_code_returns_none_regardless_of_resolver(self) -> None:
        template = resolve("no.such.code", NotificationChannel.IN_APP, tenant_id=self.TENANT_ID)

        self.assertIsNone(template)
