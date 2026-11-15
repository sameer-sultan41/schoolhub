"""Revalidation queueing and the signed webhook task (plan decision 8)."""

from __future__ import annotations

import hashlib
import hmac
import json
from unittest import mock

from django.test import TestCase, override_settings

from apps.website_cms import tasks
from apps.website_cms.revalidation import host_tag, queue_revalidation
from apps.website_cms.tests.factories import TenantFactory

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
    def test_host_tag_names_the_platform_subdomain(self) -> None:
        tenant = TenantFactory(slug="greenfield")
        self.assertEqual(host_tag(tenant), "tenant-host:greenfield.schools.test")


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

    def test_non_http_url_is_refused(self) -> None:
        with self.assertRaises(ValueError):
            tasks._post("file:///etc/passwd", b"{}", {})
