"""The feature-flag console: flag defaults and a school's overrides (§11, §16).

A disable the school cannot run without (a registered guard) is a 409 `toggle_refused`, and so
is an override that tries to switch a kill switch on.
"""

from __future__ import annotations

from datetime import timedelta
from unittest import mock

from django.utils import timezone
from rest_framework import status

from apps.platform_admin.tests.base import (
    TENANTS_URL,
    PlatformAPITestCase,
    bearer,
    make_tenant,
    platform_user,
)
from apps.school_organization.tests.factories import TenantFactory, UserFactory, grant
from core.audit.models import AuditLog
from core.tenancy import features
from core.tenancy.context import tenant_context
from core.tenancy.models import (
    FeatureFlag,
    Tenant,
    TenantFeatureOverride,
    TenantSettings,
    TenantStatus,
)

FLAGS_URL = "/api/v1/platform/feature-flags"
TIMETABLE = "module.timetable"


def overrides_url(tenant: Tenant, pk: object = None) -> str:
    url = f"{TENANTS_URL}/{tenant.pk}/feature-overrides"
    return f"{url}/{pk}" if pk is not None else url


def live_overrides(tenant: Tenant) -> list[TenantFeatureOverride]:
    with tenant_context(tenant.pk):
        return list(
            TenantFeatureOverride.objects.filter(deleted_at__isnull=True).select_related(
                "feature_flag"
            )
        )


def resolved(tenant: Tenant) -> bool:
    """`module.timetable` for ``tenant``, resolved with that school bound as a request is."""
    with tenant_context(tenant.pk):
        return features.is_feature_enabled(TIMETABLE, tenant_id=tenant.pk)


def kill_switch() -> FeatureFlag:
    """A registered flag turned into a kill switch, defaulting off."""
    flag = FeatureFlag.objects.get(key=TIMETABLE)
    flag.is_kill_switch = True
    flag.default_enabled = False
    flag.save()
    return flag


class FeatureFlagConsoleTests(PlatformAPITestCase):
    def test_list_finds_a_registered_flag(self) -> None:
        response = self.client.get(FLAGS_URL, {"search": TIMETABLE})

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        keys = {row["key"] for row in response.json()["data"]}
        self.assertIn(TIMETABLE, keys)

    def test_patch_changes_the_default_and_bumps_the_generation(self) -> None:
        flag = FeatureFlag.objects.get(key=TIMETABLE)
        generation = features.feature_cache_generation()

        response = self.client.patch(
            f"{FLAGS_URL}/{flag.pk}",
            {"default_enabled": not flag.default_enabled, "description": "ignored"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        flag.refresh_from_db()
        self.assertEqual(response.json()["data"]["default_enabled"], flag.default_enabled)
        self.assertNotEqual(flag.description, "ignored")
        self.assertGreater(features.feature_cache_generation(), generation)
        audit = AuditLog.objects.get(resource_id=flag.pk, action="update")
        self.assertEqual(audit.actor_id, self.operator.pk)
        self.assertIsNone(audit.tenant_id)

    def test_a_deploy_keeps_the_console_s_default(self) -> None:
        flag = FeatureFlag.objects.get(key=TIMETABLE)
        flag.default_enabled = not flag.default_enabled
        flag.is_kill_switch = True
        flag.save()

        features.sync_feature_flags()

        flag.refresh_from_db()
        spec = next(s for s in features.registry.all() if s.key == TIMETABLE)
        self.assertNotEqual(flag.default_enabled, spec.default_enabled)
        self.assertTrue(flag.is_kill_switch)

    def test_platform_support_reads_but_cannot_change(self) -> None:
        tenant = make_tenant(status=TenantStatus.ACTIVE)
        flag = FeatureFlag.objects.get(key=TIMETABLE)
        self.sign_in_as(platform_user("platform_support"))

        self.assertEqual(self.client.get(FLAGS_URL).status_code, status.HTTP_200_OK)
        self.assertEqual(self.client.get(overrides_url(tenant)).status_code, status.HTTP_200_OK)
        self.assertEqual(
            self.client.patch(
                f"{FLAGS_URL}/{flag.pk}", {"default_enabled": True}, format="json"
            ).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.client.post(
                overrides_url(tenant),
                {"flag": TIMETABLE, "enabled": True, "reason": "pilot"},
                format="json",
            ).status_code,
            status.HTTP_403_FORBIDDEN,
        )


class FeatureOverrideTests(PlatformAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = make_tenant(status=TenantStatus.ACTIVE)

    def post(self, **body):
        body = {"flag": TIMETABLE, "reason": "pilot", **body}
        return self.client.post(overrides_url(self.tenant), body, format="json")

    def test_override_is_listed_audited_and_resolved(self) -> None:
        response = self.post(enabled=True)

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        listed = self.client.get(overrides_url(self.tenant)).json()["data"]
        self.assertEqual([(row["flag"], row["enabled"]) for row in listed], [(TIMETABLE, True)])
        self.assertTrue(resolved(self.tenant))
        audit = AuditLog.objects.get(action="create", resource_id=response.json()["data"]["id"])
        self.assertEqual(audit.tenant_id, self.tenant.pk)

    def test_a_second_override_replaces_the_first(self) -> None:
        self.post(enabled=True)

        response = self.post(enabled=False, reason="support ticket")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        self.assertEqual([o.enabled for o in live_overrides(self.tenant)], [False])
        self.assertFalse(resolved(self.tenant))

    def test_an_unknown_flag_or_a_past_expiry_is_400(self) -> None:
        unknown = self.client.post(
            overrides_url(self.tenant),
            {"flag": "module.nope", "enabled": True, "reason": "x"},
            format="json",
        )
        past = self.post(enabled=True, expires_at=(timezone.now() - timedelta(hours=1)).isoformat())

        self.assertEqual(unknown.status_code, status.HTTP_400_BAD_REQUEST, unknown.content)
        self.assertEqual(past.status_code, status.HTTP_400_BAD_REQUEST, past.content)

    def test_override_refused_by_guard(self) -> None:
        # Attendance registers the timetable guard: a school taking attendance by period
        # cannot lose the timetable (deferred-work's period-mode item).
        with tenant_context(self.tenant.pk):
            TenantSettings.objects.update_or_create(
                tenant=self.tenant, defaults={"academic": {"attendance_mode": "period"}}
            )

        response = self.post(enabled=False)

        self.assert_error(response, status.HTTP_409_CONFLICT, "toggle_refused")
        self.assertEqual(live_overrides(self.tenant), [])

        # Removing an override that kept the module on is a disable too.
        enabling = self.post(enabled=True).json()["data"]["id"]
        with mock.patch.dict(features._plan_hooks, {"resolver": lambda _: frozenset()}):
            removal = self.client.delete(overrides_url(self.tenant, enabling))
        self.assert_error(removal, status.HTTP_409_CONFLICT, "toggle_refused")

        # A daily-attendance school may switch it off.
        with tenant_context(self.tenant.pk):
            TenantSettings.objects.filter(tenant=self.tenant).update(academic={})
        self.assertEqual(self.post(enabled=False).status_code, status.HTTP_201_CREATED)

    def test_kill_switch_override_refused(self) -> None:
        kill_switch()

        self.assert_error(self.post(enabled=True), status.HTTP_409_CONFLICT, "toggle_refused")
        self.assertEqual(live_overrides(self.tenant), [])
        # Forcing a kill switch off for one school stays allowed.
        self.assertEqual(self.post(enabled=False).status_code, status.HTTP_201_CREATED)

    def test_delete_removes_the_override(self) -> None:
        created = self.post(enabled=True).json()["data"]["id"]

        response = self.client.delete(overrides_url(self.tenant, created))

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT, response.content)
        self.assertEqual(live_overrides(self.tenant), [])
        self.assertTrue(AuditLog.objects.filter(action="delete", resource_id=created).exists())

    def test_override_of_other_tenant_404(self) -> None:
        other = TenantFactory()
        theirs = self.client.post(
            overrides_url(other), {"flag": TIMETABLE, "enabled": True, "reason": "x"}, format="json"
        ).json()["data"]["id"]

        # Named under the wrong school, another school's override does not exist.
        self.assertEqual(
            self.client.delete(overrides_url(self.tenant, theirs)).status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.assertEqual(len(live_overrides(other)), 1)
        self.assertEqual(self.client.get(overrides_url(self.tenant)).json()["data"], [])

        # A school's own principal never reaches the console, for any school.
        user = UserFactory(tenant=other)
        grant(user, "platform.job.view")
        self.client.credentials(HTTP_AUTHORIZATION=bearer(user))
        for tenant in (self.tenant, other):
            with self.subTest(tenant=tenant.slug):
                self.assertEqual(
                    self.client.get(overrides_url(tenant)).status_code, status.HTTP_404_NOT_FOUND
                )
                self.assertEqual(
                    self.client.delete(overrides_url(tenant, theirs)).status_code,
                    status.HTTP_404_NOT_FOUND,
                )
        self.assertEqual(self.client.get(FLAGS_URL).status_code, status.HTTP_404_NOT_FOUND)


class DisableGuardRegistryTests(PlatformAPITestCase):
    def test_disable_refusal_asks_every_guard_for_the_key(self) -> None:
        tenant = make_tenant(status=TenantStatus.ACTIVE)
        calls: list[object] = []

        def guard(tenant_id):
            calls.append(tenant_id)
            return "needed"

        with mock.patch.dict(features._disable_guards, {"module.x": [guard]}):
            self.assertEqual(features.disable_refusal("module.x", tenant.pk), "needed")
            self.assertIsNone(features.disable_refusal("module.y", tenant.pk))
        self.assertEqual(calls, [tenant.pk])
