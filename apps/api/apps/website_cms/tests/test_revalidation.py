"""Revalidation queueing and the signed webhook task (plan decision 8)."""

from __future__ import annotations

import hashlib
import hmac
import http.client
import json
from unittest import mock

from django.test import TestCase, override_settings

from apps.website_cms import tasks
from apps.website_cms.features import FEATURE
from apps.website_cms.models import CustomDomainStatus
from apps.website_cms.revalidation import host_tags, queue_revalidation
from apps.website_cms.tests.factories import TenantFactory, enable_feature, make_custom_domain
from core.tenancy.context import tenant_context
from core.tenancy.models import FeatureFlag, TenantFeatureOverride

URL = "http://website:3001/api/revalidate"
SECRET = "test-signing-key"


class QueueRevalidationTests(TestCase):
    def test_nothing_is_enqueued_until_commit(self) -> None:
        tenant = TenantFactory()
        with mock.patch("apps.website_cms.revalidation.revalidate_website") as task:
            with self.captureOnCommitCallbacks(execute=False) as callbacks:
                queue_revalidation(tenant.id, ["b", "a", "a"])
            task.delay.assert_not_called()
            callbacks[0]()
        task.delay.assert_called_once_with(str(tenant.id), ["a", "b"])

    @override_settings(PLATFORM_DOMAIN="schools.test")
    def test_host_tags_name_the_platform_subdomain(self) -> None:
        tenant = TenantFactory(slug="greenfield")
        self.assertEqual(host_tags(tenant), ["tenant-host:greenfield.schools.test"])

    @override_settings(PLATFORM_DOMAIN="schools.test")
    def test_host_tags_cover_every_active_custom_domain(self) -> None:
        tenant = TenantFactory(slug="greenfield")
        make_custom_domain(tenant, "www.greenfield.org", CustomDomainStatus.ACTIVE)
        make_custom_domain(tenant, "old.greenfield.org", CustomDomainStatus.DISABLED)
        self.assertEqual(
            host_tags(tenant),
            ["tenant-host:greenfield.schools.test", "tenant-host:www.greenfield.org"],
        )


@override_settings(PLATFORM_DOMAIN="schools.test")
class ModuleFlagRevalidationTests(TestCase):
    """Decision 8: switching `module.website` drops the tenant's cache on every host."""

    def setUp(self) -> None:
        self.tenant = TenantFactory(slug="greenfield")
        make_custom_domain(self.tenant, "www.greenfield.org", CustomDomainStatus.ACTIVE)
        self.expected = [
            str(self.tenant.id),
            ["tenant-host:greenfield.schools.test", "tenant-host:www.greenfield.org"],
        ]

    def test_enabling_the_module_queues_every_host_tag(self) -> None:
        with (
            mock.patch("apps.website_cms.revalidation.revalidate_website") as task,
            self.captureOnCommitCallbacks(execute=True),
        ):
            enable_feature(self.tenant, FEATURE)
        task.delay.assert_called_once_with(*self.expected)

    def test_disabling_and_removing_the_override_queue_too(self) -> None:
        enable_feature(self.tenant, FEATURE)
        with tenant_context(self.tenant.id):
            override = TenantFeatureOverride.objects.get(feature_flag__key=FEATURE)
            for name, change in (("disable", override.save), ("remove", override.delete)):
                with (
                    self.subTest(change=name),
                    mock.patch("apps.website_cms.revalidation.revalidate_website") as task,
                    self.captureOnCommitCallbacks(execute=True),
                ):
                    override.enabled = False
                    change()
                task.delay.assert_called_once_with(*self.expected)

    def test_another_modules_flag_queues_nothing(self) -> None:
        other = FeatureFlag.objects.exclude(key=FEATURE).first()
        assert other is not None
        with (
            mock.patch("apps.website_cms.revalidation.revalidate_website") as task,
            self.captureOnCommitCallbacks(execute=True),
        ):
            enable_feature(self.tenant, other.key)
        task.delay.assert_not_called()


@override_settings(WEBSITE_REVALIDATE_URL=URL, WEBSITE_REVALIDATE_SECRET=SECRET)
class RevalidateTaskTests(TestCase):
    def test_revalidation_task_signs_body_with_hmac(self) -> None:
        with mock.patch.object(tasks, "_post", return_value=200) as post:
            tasks.revalidate_website("tenant-1", ["tenant-host:a.b"])
        url, body, headers = post.call_args.args
        self.assertEqual(url, URL)
        self.assertEqual(json.loads(body), {"tenant_id": "tenant-1", "tags": ["tenant-host:a.b"]})
        expected = hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
        self.assertEqual(headers["x-schoolhub-signature"], expected)
        self.assertEqual(headers["Content-Type"], "application/json")

    @override_settings(WEBSITE_REVALIDATE_URL="")
    def test_revalidation_noop_without_url(self) -> None:
        with mock.patch.object(tasks, "_post") as post:
            tasks.revalidate_website("tenant-1", [])
        post.assert_not_called()

    @override_settings(WEBSITE_REVALIDATE_SECRET="")
    def test_revalidation_fails_closed_without_secret(self) -> None:
        with mock.patch.object(tasks, "_post") as post:
            tasks.revalidate_website("tenant-1", [])
        post.assert_not_called()

    def test_server_error_raises_so_celery_retries(self) -> None:
        with (
            mock.patch.object(tasks, "_post", return_value=503),
            self.assertRaises(tasks.RevalidationFailed),
        ):
            tasks.revalidate_website.run("tenant-1", [])

    def test_client_error_is_not_retried(self) -> None:
        with mock.patch.object(tasks, "_post", return_value=401):
            tasks.revalidate_website.run("tenant-1", [])

    def test_task_is_registered_under_its_contract_name(self) -> None:
        self.assertEqual(tasks.revalidate_website.name, "website_cms.revalidate_website")
        self.assertEqual(tasks.revalidate_website.max_retries, 5)

    def test_a_malformed_or_truncated_response_is_retried(self) -> None:
        # `IncompleteRead` and `BadStatusLine` are `HTTPException`s, not `OSError`s.
        retried = tuple(tasks.revalidate_website.autoretry_for)
        for error in (http.client.IncompleteRead, http.client.BadStatusLine):
            with self.subTest(error=error.__name__):
                self.assertTrue(issubclass(error, retried))

    def test_non_http_url_is_refused(self) -> None:
        with self.assertRaises(ValueError):
            tasks._post("file:///etc/passwd", b"{}", {})
