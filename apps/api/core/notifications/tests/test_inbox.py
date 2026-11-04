"""`/notifications` — the caller's own inbox, mark-read and the unread count."""

from __future__ import annotations

import datetime
import uuid

from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.communication.models import ThreadType
from apps.communication.notifications import THREAD_REPLY
from apps.communication.threads.services.post_message import post_message
from apps.communication.threads.tests.base import ThreadAPITestCase
from apps.school_organization.tests.factories import TenantFactory, UserFactory, authenticate, grant
from core.notifications.models import Notification, NotificationCategory
from core.rbac.models import RecordScope
from core.rbac.registry import registry
from core.rbac.roles import ALL_TENANT_ROLES
from core.tenancy.context import tenant_context

URL = "/api/v1/notifications"
VIEW_KEY = "platform.notification.view"


def make_notification(tenant, user, **fields) -> Notification:
    """One inbox row; `created_at` (auto-stamped) is overridden through `update`."""
    created_at = fields.pop("created_at", None)
    with tenant_context(tenant.id):
        row = Notification.objects.create(
            tenant_id=tenant.pk,
            user_id=user.pk,
            event_key=fields.pop("event_key", "test.event"),
            title=fields.pop("title", "Title"),
            body=fields.pop("body", "Body"),
            **fields,
        )
        if created_at is not None:
            Notification.objects.filter(pk=row.pk).update(created_at=created_at)
            row.refresh_from_db()
    return row


class InboxTestCase(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        self.other = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)
        grant(self.user, VIEW_KEY)

    def listed_ids(self, response) -> list[str]:
        return [row["id"] for row in response.json()["data"]]


class InboxTests(InboxTestCase):
    def test_inbox_lists_only_own_rows(self) -> None:
        mine = make_notification(self.tenant, self.user)
        make_notification(self.tenant, self.other)

        response = self.client.get(URL)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(self.listed_ids(response), [str(mine.pk)])
        self.assertEqual(
            set(response.json()["data"][0]),
            {
                "id",
                "event_key",
                "category",
                "title",
                "body",
                "data",
                "source_type",
                "source_id",
                "priority",
                "read_at",
                "created_at",
            },
        )

    def test_inbox_is_own_rows_even_for_scope_all(self) -> None:
        # `grant` defaults to scope `all`: the widest a record scope goes.
        theirs = make_notification(self.tenant, self.other)

        response = self.client.get(URL)
        self.assertEqual(self.listed_ids(response), [])

        detail = self.client.get(f"{URL}/{theirs.pk}")
        self.assertEqual(detail.status_code, status.HTTP_404_NOT_FOUND)

    def test_retrieve_own_notification(self) -> None:
        mine = make_notification(self.tenant, self.user, category=NotificationCategory.FEES)

        response = self.client.get(f"{URL}/{mine.pk}")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["category"], "fees")

    def test_list_is_newest_first(self) -> None:
        now = timezone.now()
        old = make_notification(self.tenant, self.user, created_at=now - datetime.timedelta(days=2))
        new = make_notification(self.tenant, self.user, created_at=now)

        response = self.client.get(URL)

        self.assertEqual(self.listed_ids(response), [str(new.pk), str(old.pk)])

    def test_without_the_permission_key_is_403(self) -> None:
        stranger = UserFactory(tenant=self.tenant)
        authenticate(self.client, stranger)

        self.assertEqual(self.client.get(URL).status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.get(f"{URL}:unread-count").status_code, 403)

    def test_read_filter_and_unread_count(self) -> None:
        unread = make_notification(self.tenant, self.user, category=NotificationCategory.FEES)
        read = make_notification(self.tenant, self.user, read_at=timezone.now())
        make_notification(self.tenant, self.other)

        only_unread = self.client.get(URL, {"read": "false"})
        only_read = self.client.get(URL, {"read": "true"})
        fees = self.client.get(URL, {"category": "fees"})
        count = self.client.get(f"{URL}:unread-count")

        self.assertEqual(self.listed_ids(only_unread), [str(unread.pk)])
        self.assertEqual(self.listed_ids(only_read), [str(read.pk)])
        self.assertEqual(self.listed_ids(fees), [str(unread.pk)])
        self.assertEqual(count.status_code, status.HTTP_200_OK, count.json())
        self.assertEqual(count.json()["data"], {"unread": 1})


class MarkReadTests(InboxTestCase):
    def test_mark_read_other_users_notification_is_404(self) -> None:
        theirs = make_notification(self.tenant, self.other)

        response = self.client.post(f"{URL}/{theirs.pk}:mark-read")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        with tenant_context(self.tenant.id):
            theirs.refresh_from_db()
        self.assertIsNone(theirs.read_at)

    def test_mark_read_is_idempotent(self) -> None:
        row = make_notification(self.tenant, self.user)

        first = self.client.post(f"{URL}/{row.pk}:mark-read")
        second = self.client.post(f"{URL}/{row.pk}:mark-read")

        self.assertEqual(first.status_code, status.HTTP_200_OK, first.json())
        self.assertEqual(second.status_code, status.HTTP_200_OK, second.json())
        self.assertIsNotNone(first.json()["data"]["read_at"])
        self.assertEqual(first.json()["data"]["read_at"], second.json()["data"]["read_at"])

    def test_mark_all_read_leaves_rows_after_before(self) -> None:
        now = timezone.now()
        cutoff = now - datetime.timedelta(hours=1)
        before = cutoff - datetime.timedelta(minutes=5)
        after = cutoff + datetime.timedelta(minutes=5)
        early = make_notification(self.tenant, self.user, created_at=before)
        late = make_notification(self.tenant, self.user, created_at=after)
        theirs = make_notification(self.tenant, self.other, created_at=before)

        response = self.client.post(
            f"{URL}:mark-all-read", {"before": cutoff.isoformat()}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"], {"marked": 1})
        with tenant_context(self.tenant.id):
            for row in (early, late, theirs):
                row.refresh_from_db()
        self.assertIsNotNone(early.read_at)
        self.assertIsNone(late.read_at)
        self.assertIsNone(theirs.read_at)

    def test_mark_all_read_without_before_marks_everything_so_far(self) -> None:
        make_notification(self.tenant, self.user)
        make_notification(self.tenant, self.user)
        make_notification(self.tenant, self.user, read_at=timezone.now())

        response = self.client.post(f"{URL}:mark-all-read", {}, format="json")

        self.assertEqual(response.json()["data"], {"marked": 2})
        self.assertEqual(self.client.get(f"{URL}:unread-count").json()["data"], {"unread": 0})

    def test_mark_all_read_is_one_update(self) -> None:
        for _ in range(3):
            make_notification(self.tenant, self.user)

        with CaptureQueriesContext(connection) as queries:
            response = self.client.post(f"{URL}:mark-all-read", {}, format="json")

        self.assertEqual(response.json()["data"], {"marked": 3})
        updates = [q for q in queries.captured_queries if q["sql"].lstrip().startswith("UPDATE")]
        self.assertEqual(len(updates), 1, [q["sql"] for q in updates])


class InboxCrossTenantTests(InboxTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.other_tenant = TenantFactory()
        foreign_user = UserFactory(tenant=self.other_tenant)
        # Same user id as the caller would be a forgery; the row simply belongs to another school.
        self.foreign = make_notification(self.other_tenant, foreign_user)

    def test_retrieve_another_tenants_notification_is_404(self) -> None:
        response = self.client.get(f"{URL}/{self.foreign.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_mark_read_another_tenants_notification_is_404(self) -> None:
        response = self.client.post(f"{URL}/{self.foreign.pk}:mark-read")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        with tenant_context(self.other_tenant.id):
            self.foreign.refresh_from_db()
        self.assertIsNone(self.foreign.read_at)

    def test_a_missing_id_is_404(self) -> None:
        self.assertEqual(
            self.client.post(f"{URL}/{uuid.uuid4()}:mark-read").status_code,
            status.HTTP_404_NOT_FOUND,
        )


class GuardianInboxTests(ThreadAPITestCase):
    def test_guardian_reads_thread_reply_in_inbox(self) -> None:
        grant(self.guardian_user, VIEW_KEY, scope=RecordScope.OWN, is_restricted_principal=True)
        thread = self.make_thread(
            self.user,
            self.guardian_user,
            thread_type=ThreadType.GUARDIAN_SCHOOL,
            student=self.student,
        )

        with self.captureOnCommitCallbacks(execute=True):
            post_message(
                thread=thread,
                sender=self.user,
                body="Please collect the form.",
                attachments=None,
                is_internal_note=False,
            )
        authenticate(self.client, self.guardian_user)
        response = self.client.get(URL)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        rows = response.json()["data"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["event_key"], THREAD_REPLY)
        self.assertEqual(rows[0]["source_type"], "message_thread")
        self.assertEqual(rows[0]["source_id"], str(thread.pk))
        self.assertIn("Please collect the form.", rows[0]["body"])
        self.assertEqual(self.client.get(f"{URL}:unread-count").json()["data"], {"unread": 1})


class NotificationViewKeyRegistryTests(APITestCase):
    def test_every_default_role_holds_notification_view(self) -> None:
        spec = next(s for s in registry.all() if s.key == VIEW_KEY)
        self.assertEqual(spec.default_roles, ALL_TENANT_ROLES)

        # A role added to any key without joining ALL_TENANT_ROLES would miss the inbox.
        unknown = {
            (s.key, role)
            for s in registry.all()
            for role in s.default_roles
            if role not in ALL_TENANT_ROLES
        }
        self.assertEqual(unknown, set())
