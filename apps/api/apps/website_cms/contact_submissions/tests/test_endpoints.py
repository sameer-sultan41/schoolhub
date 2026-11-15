"""Endpoint and service tests for `/contact-submissions` and the contact notification."""

from __future__ import annotations

from apps.school_organization.tests.factories import grant_default_role
from apps.website_cms.contact_submissions.services import create_contact_submission
from apps.website_cms.models import ContactStatus, ContactSubmission
from apps.website_cms.tests.base import WebsiteAPITestCase
from apps.website_cms.tests.factories import UserFactory
from core.notifications.models import Notification
from core.tenancy.context import tenant_context

LIST = "/api/v1/contact-submissions"


def detail(row) -> str:
    return f"{LIST}/{row.id}"


class ContactInboxTests(WebsiteAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow("website.contact-submission.view")

    def test_list_and_detail_need_the_view_key(self) -> None:
        row = self.make_contact()
        self.assertEqual(self.client.get(LIST).status_code, 200)
        self.assertEqual(self.client.get(detail(row)).status_code, 200)

    def test_list_without_the_key_is_403(self) -> None:
        self.sign_in_reader()
        self.assertEqual(self.client.get(LIST).status_code, 403)

    def test_filters_by_status_and_search(self) -> None:
        self.make_contact(name="Amina Khan")
        self.make_contact(name="Bilal", status=ContactStatus.SPAM)
        spam = self.client.get(f"{LIST}?status=spam").json()["data"]
        self.assertEqual([r["name"] for r in spam], ["Bilal"])
        found = self.client.get(f"{LIST}?search=Amina").json()["data"]
        self.assertEqual([r["name"] for r in found], ["Amina Khan"])

    def test_filters_by_created_at_range(self) -> None:
        self.make_contact()
        future = self.client.get(f"{LIST}?created_at__gte=2999-01-01T00:00:00Z")
        self.assertEqual(future.json()["data"], [])
        past = self.client.get(f"{LIST}?created_at__lte=2999-01-01T00:00:00Z")
        self.assertEqual(len(past.json()["data"]), 1)

    def test_ip_never_serialised_to_staff_api(self) -> None:
        row = self.make_contact(ip="198.51.100.9")
        for payload in (
            self.client.get(LIST).json()["data"][0],
            self.client.get(detail(row)).json()["data"],
        ):
            self.assertNotIn("ip", payload)
            self.assertNotIn("198.51.100.9", str(payload))


class ContactTriageTests(WebsiteAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow("website.contact-submission.view")
        self.row = self.make_contact()

    def _patch(self, payload: dict):
        return self.client.patch(detail(self.row), payload, format="json")

    def test_patch_needs_the_update_key(self) -> None:
        self.assertEqual(self._patch({"status": "read"}).status_code, 403)

    def test_patch_sets_handled_by(self) -> None:
        self.allow("website.contact-submission.update")
        response = self._patch({"status": "responded"})
        self.assertEqual(response.status_code, 200)
        with tenant_context(self.tenant.id):
            row = ContactSubmission.objects.get(pk=self.row.pk)
        self.assertEqual(row.status, "responded")
        self.assertEqual(row.handled_by_id, self.user.pk)
        self.assertEqual(response.json()["data"]["handled_by_id"], str(self.user.pk))

    def test_only_status_writable(self) -> None:
        self.allow("website.contact-submission.update")
        extra = {"name": "Hacked", "message": "x", "email": "e@x.org", "ip": "1.1.1.1"}
        response = self._patch({"status": "read", **extra})
        self.assertEqual(response.status_code, 200)
        with tenant_context(self.tenant.id):
            row = ContactSubmission.objects.get(pk=self.row.pk)
        self.assertEqual(row.status, "read")
        self.assertEqual(row.name, self.row.name)
        self.assertEqual(row.message, self.row.message)
        self.assertEqual(row.email, self.row.email)
        self.assertEqual(row.ip, "203.0.113.7")

    def test_unknown_status_is_rejected(self) -> None:
        self.allow("website.contact-submission.update")
        self.assertEqual(self._patch({"status": "archived"}).status_code, 400)

    def test_put_post_delete_are_not_routed(self) -> None:
        self.allow("website.contact-submission.update")
        self.assertEqual(self.client.delete(detail(self.row)).status_code, 405)
        self.assertEqual(self.client.post(LIST, {}, format="json").status_code, 405)


class CreateContactSubmissionTests(WebsiteAPITestCase):
    def _staff(self, slug: str):
        user = UserFactory(tenant=self.tenant)
        grant_default_role(user, slug)
        return user

    def _create(self, **data):
        payload = {"name": "Sara", "email": "sara@example.com", "message": "Hello", **data}
        with tenant_context(self.tenant.id):
            return create_contact_submission(self.tenant, payload, "203.0.113.5", None)

    def test_create_stores_a_new_submission_with_ip_and_no_author(self) -> None:
        with self.captureOnCommitCallbacks(execute=True):
            row = self._create(subject="Admissions")
        self.assertEqual(row.status, "new")
        self.assertEqual(row.ip, "203.0.113.5")
        self.assertIsNone(row.created_by)
        self.assertEqual(row.subject, "Admissions")

    def test_create_notifies_reception_and_admin(self) -> None:
        reception = self._staff("reception")
        admin = self._staff("school_admin")
        outsider = self._staff("it_admin")
        with self.captureOnCommitCallbacks(execute=True):
            row = self._create()
        with tenant_context(self.tenant.id):
            rows = Notification.objects.filter(source_id=row.id)
            recipients = {n.user_id for n in rows}
            self.assertEqual(recipients, {reception.pk, admin.pk})
            self.assertNotIn(outsider.pk, recipients)
            self.assertTrue(all(n.title.startswith("New website message") for n in rows))

    def test_nothing_is_sent_before_commit(self) -> None:
        self._staff("reception")
        with self.captureOnCommitCallbacks(execute=False):
            row = self._create()
        with tenant_context(self.tenant.id):
            self.assertFalse(Notification.objects.filter(source_id=row.id).exists())

    def test_other_tenants_staff_are_not_notified(self) -> None:
        other = self.make_other_tenant()
        stranger = UserFactory(tenant=other)
        grant_default_role(stranger, "reception")
        with self.captureOnCommitCallbacks(execute=True):
            row = self._create()
        with tenant_context(other.id):
            self.assertFalse(Notification.objects.filter(source_id=row.id).exists())
