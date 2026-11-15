"""The page row lock that serialises publish and section writes (L30, L52).

`TransactionTestCase`, as in `core/rbac/tests/test_concurrency.py`: one call holds its
transaction open on this connection while a second thread's call runs on its own connection,
and `pg_locks` shows when that second call is waiting. Both tests are guarded by their outcome:
without the page lock the contender of the first still waits (on the uncommitted unique-index
entry) and then fails with an IntegrityError, and the contender of the second publishes a page
whose only visible section was just removed.
"""

from __future__ import annotations

import time
from concurrent.futures import Future, ThreadPoolExecutor

from django.db import IntegrityError, connection, connections
from django.test import TransactionTestCase

from apps.website_cms.models import ContentStatus, PageSection, WebsitePage
from apps.website_cms.pages.services import publish_page, replace_sections
from apps.website_cms.tests.factories import (
    PageSectionFactory,
    TenantFactory,
    UserFactory,
    WebsitePageFactory,
    default_theme,
)
from core.api.exceptions import DomainRuleViolation
from core.tenancy.context import tenant_atomic

LOCK_WAIT_SECONDS = 10
LOCK_POLL_SECONDS = 0.05


def hero(heading: str) -> dict:
    return {"section_type": "hero", "content": {"heading": heading}, "is_visible": True}


class PageLockTests(TransactionTestCase):
    def setUp(self) -> None:
        super().setUp()
        default_theme()  # TransactionTestCase flushes the post_migrate-synced theme rows
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        with tenant_atomic(self.tenant.id):
            self.page = WebsitePageFactory(tenant=self.tenant)

    def wait_until_blocked(self, contending: Future) -> None:
        """Poll `pg_locks` until some backend waits on a lock, i.e. the contender is blocked."""
        deadline = time.monotonic() + LOCK_WAIT_SECONDS
        while time.monotonic() < deadline:
            with connection.cursor() as cursor:
                cursor.execute("SELECT count(*) FROM pg_locks WHERE NOT granted")
                (waiting,) = cursor.fetchone()
            if waiting:
                return
            self.assertFalse(contending.done(), "the contending call returned without waiting")
            time.sleep(LOCK_POLL_SECONDS)
        self.fail("the contending call never waited on the page lock")

    def test_two_first_writes_on_an_empty_page_do_not_collide(self) -> None:
        def contender() -> type[Exception] | None:
            try:
                with tenant_atomic(self.tenant.id):
                    page = WebsitePage.objects.get(pk=self.page.pk)
                    replace_sections(page, [hero("Second")], self.user)
                return None
            except IntegrityError:
                return IntegrityError
            finally:
                connections.close_all()  # this thread's own connection

        with ThreadPoolExecutor(max_workers=1) as pool:
            with tenant_atomic(self.tenant.id):
                replace_sections(self.page, [hero("First")], self.user)
                contending = pool.submit(contender)
                self.wait_until_blocked(contending)
            outcome = contending.result(timeout=LOCK_WAIT_SECONDS)

        self.assertIsNone(outcome)
        with tenant_atomic(self.tenant.id):
            live = list(PageSection.objects.alive().filter(website_page=self.page))
        self.assertEqual([s.content["heading"] for s in live], ["Second"])

    def test_publish_waits_for_a_section_write_that_hides_the_last_section(self) -> None:
        with tenant_atomic(self.tenant.id):
            PageSectionFactory(tenant=self.tenant, website_page=self.page, position=0)

        def contender() -> type[Exception] | None:
            try:
                with tenant_atomic(self.tenant.id):
                    publish_page(WebsitePage.objects.get(pk=self.page.pk), self.user)
                return None
            except DomainRuleViolation:
                return DomainRuleViolation
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as pool:
            with tenant_atomic(self.tenant.id):
                replace_sections(self.page, [], self.user)
                contending = pool.submit(contender)
                self.wait_until_blocked(contending)
            outcome = contending.result(timeout=LOCK_WAIT_SECONDS)

        self.assertIs(outcome, DomainRuleViolation)
        with tenant_atomic(self.tenant.id):
            self.assertEqual(WebsitePage.objects.get(pk=self.page.pk).status, ContentStatus.DRAFT)
