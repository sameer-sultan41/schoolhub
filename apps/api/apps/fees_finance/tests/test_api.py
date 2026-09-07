"""The endpoints — §16's fee-configuration and ledger routes.

The cases worth reading twice are the ones that assert a *refusal*: a fee head
pointing at the wrong kind of account, a structure activated with no lines, a
second active structure at the same scope, and an unbalanced manual journal.
Each of those is a rule no constraint could hold, so the endpoint is the only
place it can be proven.
"""

from __future__ import annotations

import datetime
from decimal import Decimal

from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.fees_finance.models import (
    FeeFrequency,
    FeeStructure,
    FeeStructureStatus,
    LedgerAccountType,
    LedgerEntry,
)
from apps.fees_finance.tests.base import FEATURE, FeesFinanceAPITestCase
from apps.fees_finance.tests.factories import (
    ClassFactory,
    FeeHeadFactory,
    FeeScheduleFactory,
    FeeStructureFactory,
    LedgerAccountFactory,
    UserFactory,
    authenticate,
    disable_feature,
    grant,
    posting,
)
from core.tenancy.context import tenant_context


def _fields(response) -> set[str]:
    """The field names in an error envelope.

    `error.details` is a flat list of `{field, issue}` — see
    `core/api/exceptions._flatten_details`, and the `DomainRuleViolation`
    docstring for why structured payloads go in `meta` instead.
    """
    return {entry["field"] for entry in response.json()["error"]["details"]}


class LedgerAccountEndpointTests(FeesFinanceAPITestCase):
    def test_the_seeded_chart_of_accounts_is_listed(self) -> None:
        response = self.client.get("/api/v1/ledger-accounts")

        self.assertEqual(response.status_code, 200)
        codes = {row["code"] for row in response.json()["data"]}
        self.assertTrue({"1000", "4000", "5000"} <= codes)

    def test_a_child_account_must_share_its_parent_s_type(self) -> None:
        """An income account nested under an asset one would make every report
        that walks the hierarchy wrong."""
        response = self.client.post(
            "/api/v1/ledger-accounts",
            {
                "code": "4001",
                "name": "Tuition — primary",
                "account_type": LedgerAccountType.INCOME,
                "parent": str(self.cash.pk),
            },
            format="json",
        )

        # A serializer ValidationError is a 400 by design; 422 is for a
        # DomainRuleViolation, which this is not — the field simply does not
        # validate. `details` is a flat list of {field, issue}, per
        # core/api/exceptions._flatten_details.
        self.assertEqual(response.status_code, 400)
        self.assertIn("parent", _fields(response))

    def test_a_child_account_under_a_matching_parent_is_accepted(self) -> None:
        response = self.client.post(
            "/api/v1/ledger-accounts",
            {
                "code": "4001",
                "name": "Tuition — primary",
                "account_type": LedgerAccountType.INCOME,
                "parent": str(self.fee_income.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)

    def test_a_system_account_cannot_be_archived(self) -> None:
        """This module's own postings target the system accounts by code, so
        archiving one would break collection for the whole tenant."""
        response = self.client.patch(
            f"/api/v1/ledger-accounts/{self.cash.pk}", {"is_active": False}, format="json"
        )

        self.assertEqual(response.status_code, 422)

    def test_a_system_account_cannot_be_deleted(self) -> None:
        response = self.client.delete(f"/api/v1/ledger-accounts/{self.cash.pk}")

        self.assertEqual(response.status_code, 422)

    def test_an_ordinary_account_may_be_archived(self) -> None:
        with tenant_context(self.tenant.id):
            account = LedgerAccountFactory(tenant=self.tenant, code="4500")

        response = self.client.patch(
            f"/api/v1/ledger-accounts/{account.pk}", {"is_active": False}, format="json"
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["data"]["is_active"])


class LedgerEntryEndpointTests(FeesFinanceAPITestCase):
    def test_the_ledger_is_read_only_no_matter_the_permission(self) -> None:
        """No create route exists, so this is a 405 rather than a 403.

        A client that could POST one line could post an unbalanced transaction,
        and balance is a property of the set — hence `:post-journal`, which
        takes the whole posting.
        """
        response = self.client.post(
            "/api/v1/ledger-entries",
            {"entry_date": "2026-09-01", "debit": "10.00"},
            format="json",
        )

        self.assertEqual(response.status_code, 405)

    def test_entries_are_listed_with_their_account_names(self) -> None:
        posting(self.tenant, debit_account=self.cash, credit_account=self.fee_income)

        response = self.client.get("/api/v1/ledger-entries")

        self.assertEqual(response.status_code, 200)
        rows = response.json()["data"]
        self.assertEqual(len(rows), 2)
        self.assertEqual({row["account_code"] for row in rows}, {"1000", "4000"})

    def test_a_page_of_entries_does_not_cost_a_query_per_row(self) -> None:
        """The serializer renders each entry's account code and name, so
        without `select_related` a page is an N+1 over the module's
        highest-volume table.

        Asserted as "the count does not grow with the row count" rather than
        against a fixed number. The absolute figure includes session, tenant and
        permission-cache lookups that have nothing to do with this endpoint, and
        pinning it would make the test fail on an unrelated change while still
        not proving the thing it is named for.
        """
        posting(self.tenant, debit_account=self.cash, credit_account=self.fee_income)
        self.client.get("/api/v1/ledger-entries")  # warm the permission caches

        with CaptureQueriesContext(connection) as few:
            self.client.get("/api/v1/ledger-entries")

        for _ in range(9):
            posting(self.tenant, debit_account=self.cash, credit_account=self.fee_income)

        with CaptureQueriesContext(connection) as many:
            response = self.client.get("/api/v1/ledger-entries")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["data"]), 20)
        self.assertEqual(len(many), len(few))

    def test_a_manual_journal_posts_a_balanced_transaction(self) -> None:
        response = self.client.post(
            "/api/v1/ledger-entries:post-journal",
            {
                "entry_date": "2026-09-01",
                "memo": "Opening cash float",
                "lines": [
                    {"ledger_account": str(self.cash.pk), "debit": "500.00"},
                    {"ledger_account": str(self.fee_income.pk), "credit": "500.00"},
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(len(response.json()["data"]), 2)
        with tenant_context(self.tenant.id):
            self.assertEqual(LedgerEntry.objects.count(), 2)

    def test_an_unbalanced_manual_journal_is_refused_and_writes_nothing(self) -> None:
        response = self.client.post(
            "/api/v1/ledger-entries:post-journal",
            {
                "entry_date": "2026-09-01",
                "memo": "Wrong",
                "lines": [
                    {"ledger_account": str(self.cash.pk), "debit": "500.00"},
                    {"ledger_account": str(self.fee_income.pk), "credit": "400.00"},
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 422)
        with tenant_context(self.tenant.id):
            self.assertEqual(LedgerEntry.objects.count(), 0)

    def test_a_single_line_journal_is_refused(self) -> None:
        """Double-entry needs both sides; one line cannot be validated at all."""
        response = self.client.post(
            "/api/v1/ledger-entries:post-journal",
            {
                "entry_date": "2026-09-01",
                "memo": "Half a posting",
                "lines": [{"ledger_account": str(self.cash.pk), "debit": "500.00"}],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_a_line_carrying_both_debit_and_credit_is_refused(self) -> None:
        response = self.client.post(
            "/api/v1/ledger-entries:post-journal",
            {
                "entry_date": "2026-09-01",
                "memo": "Ambiguous",
                "lines": [
                    {"ledger_account": str(self.cash.pk), "debit": "10.00", "credit": "10.00"},
                    {"ledger_account": str(self.fee_income.pk), "credit": "10.00"},
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_a_journal_with_no_memo_is_refused(self) -> None:
        """A trial-balance line an auditor cannot trace to a stated reason is
        the line that costs a school its audit."""
        response = self.client.post(
            "/api/v1/ledger-entries:post-journal",
            {
                "entry_date": "2026-09-01",
                "memo": "",
                "lines": [
                    {"ledger_account": str(self.cash.pk), "debit": "10.00"},
                    {"ledger_account": str(self.fee_income.pk), "credit": "10.00"},
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_the_is_reversed_filter_hides_superseded_postings(self) -> None:
        from django.db import transaction as db_transaction

        from apps.fees_finance.ledger import reverse_transaction

        original = posting(self.tenant, debit_account=self.cash, credit_account=self.fee_income)
        with tenant_context(self.tenant.id), db_transaction.atomic():
            reverse_transaction(transaction_id=original, entry_date=datetime.date(2026, 9, 5))

        response = self.client.get("/api/v1/ledger-entries?is_reversed=false")

        self.assertEqual(response.status_code, 200)
        # Only the reversal's own lines still stand; the originals are stamped.
        transaction_ids = {row["transaction_id"] for row in response.json()["data"]}
        self.assertNotIn(str(original), transaction_ids)


class FeeHeadEndpointTests(FeesFinanceAPITestCase):
    def test_a_head_must_map_to_an_income_account(self) -> None:
        """A fee mapped to an asset account produces receipts that balance and
        an income statement that is wrong — found months later at year end."""
        response = self.client.post(
            "/api/v1/fee-heads",
            {
                "name": "Tuition",
                "code": "TUITION",
                "category": "tuition",
                "ledger_account": str(self.cash.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, 422)
        self.assertIn("ledger_account", _fields(response))

    def test_a_head_mapped_to_income_is_created(self) -> None:
        response = self.client.post(
            "/api/v1/fee-heads",
            {
                "name": "Tuition",
                "code": "TUITION",
                "category": "tuition",
                "ledger_account": str(self.fee_income.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)

    def test_a_head_priced_into_a_schedule_cannot_be_deleted(self) -> None:
        """Historical invoice lines refer to it; deleting would leave charges
        nobody can name. Deactivation is the retirement path."""
        with tenant_context(self.tenant.id):
            head = FeeHeadFactory(tenant=self.tenant, ledger_account=self.fee_income)
            structure = FeeStructureFactory(tenant=self.tenant, academic_session=self.session)
            FeeScheduleFactory(tenant=self.tenant, fee_structure=structure, fee_head=head)

        response = self.client.delete(f"/api/v1/fee-heads/{head.pk}")

        self.assertEqual(response.status_code, 422)

    def test_an_unused_head_may_be_deleted(self) -> None:
        with tenant_context(self.tenant.id):
            head = FeeHeadFactory(tenant=self.tenant, ledger_account=self.fee_income)

        response = self.client.delete(f"/api/v1/fee-heads/{head.pk}")

        self.assertEqual(response.status_code, 204)

    def test_the_category_filter_narrows_the_list(self) -> None:
        with tenant_context(self.tenant.id):
            FeeHeadFactory(tenant=self.tenant, ledger_account=self.fee_income, category="tuition")
            FeeHeadFactory(tenant=self.tenant, ledger_account=self.fee_income, category="transport")

        response = self.client.get("/api/v1/fee-heads?category=transport")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["data"]), 1)


class FeeStructureEndpointTests(FeesFinanceAPITestCase):
    def _structure(self, **kwargs) -> FeeStructure:
        with tenant_context(self.tenant.id):
            return FeeStructureFactory(tenant=self.tenant, academic_session=self.session, **kwargs)

    def _priced(self, structure: FeeStructure) -> None:
        with tenant_context(self.tenant.id):
            head = FeeHeadFactory(tenant=self.tenant, ledger_account=self.fee_income)
            FeeScheduleFactory(tenant=self.tenant, fee_structure=structure, fee_head=head)

    def test_a_structure_with_no_schedules_cannot_be_activated(self) -> None:
        """It would charge nothing — a whole class silently billed zero, which
        nobody notices until the term's collection report."""
        structure = self._structure()

        response = self.client.post(f"/api/v1/fee-structures/{structure.pk}:activate")

        self.assertEqual(response.status_code, 422)
        self.assertIn("charge nothing", str(response.json()["error"]))

    def test_a_priced_structure_activates(self) -> None:
        structure = self._structure()
        self._priced(structure)

        response = self.client.post(f"/api/v1/fee-structures/{structure.pk}:activate")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["status"], FeeStructureStatus.ACTIVE)

    def test_a_second_active_structure_at_the_same_scope_is_refused(self) -> None:
        """Two active structures make "which price applies?" ambiguous, and the
        unique index cannot express it — it includes `name`, so two differently
        named structures at one scope are database-legal."""
        first = self._structure(name="Standard", school_class=self.school_class)
        self._priced(first)
        self.client.post(f"/api/v1/fee-structures/{first.pk}:activate")

        second = self._structure(name="Revised", school_class=self.school_class)
        self._priced(second)

        response = self.client.post(f"/api/v1/fee-structures/{second.pk}:activate")

        self.assertEqual(response.status_code, 422)
        self.assertEqual(
            response.json()["error"]["meta"]["conflicting_structure_id"], str(first.pk)
        )

    def test_the_same_scope_becomes_available_once_the_first_is_archived(self) -> None:
        first = self._structure(name="Standard", school_class=self.school_class)
        self._priced(first)
        self.client.post(f"/api/v1/fee-structures/{first.pk}:activate")
        self.client.post(f"/api/v1/fee-structures/{first.pk}:archive")

        second = self._structure(name="Revised", school_class=self.school_class)
        self._priced(second)

        response = self.client.post(f"/api/v1/fee-structures/{second.pk}:activate")

        self.assertEqual(response.status_code, 200)

    def test_another_class_may_be_active_at_the_same_time(self) -> None:
        """The control: scope is per class, so two classes priced separately is
        the normal case."""
        first = self._structure(name="Standard", school_class=self.school_class)
        self._priced(first)
        self.client.post(f"/api/v1/fee-structures/{first.pk}:activate")

        with tenant_context(self.tenant.id):
            other = ClassFactory(tenant=self.tenant, level=3)
        second = self._structure(name="Standard", school_class=other)
        self._priced(second)

        response = self.client.post(f"/api/v1/fee-structures/{second.pk}:activate")

        self.assertEqual(response.status_code, 200)

    def test_status_cannot_be_patched_past_the_activation_checks(self) -> None:
        """`status` is read-only on the serializer, so a PATCH cannot skip the
        set-level rules `:activate` runs."""
        structure = self._structure()

        response = self.client.patch(
            f"/api/v1/fee-structures/{structure.pk}",
            {"status": FeeStructureStatus.ACTIVE},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["status"], FeeStructureStatus.DRAFT)

    def test_a_list_of_structures_does_not_cost_a_query_per_structure(self) -> None:
        """`schedules` is nested on the serializer, so without the prefetch this
        is an N+1 over the screen an accountant opens first.

        Compared at two sizes rather than against a fixed number, for the reason
        `test_a_page_of_entries_does_not_cost_a_query_per_row` gives.
        """
        self._priced(self._structure(name="S0"))
        self.client.get("/api/v1/fee-structures")  # warm the permission caches

        with CaptureQueriesContext(connection) as few:
            self.client.get("/api/v1/fee-structures")

        for index in range(1, 6):
            self._priced(self._structure(name=f"S{index}"))

        with CaptureQueriesContext(connection) as many:
            response = self.client.get("/api/v1/fee-structures")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["data"]), 6)
        self.assertEqual(len(many), len(few))


class FeeScheduleEndpointTests(FeesFinanceAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.structure = FeeStructureFactory(tenant=self.tenant, academic_session=self.session)
            self.head = FeeHeadFactory(tenant=self.tenant, ledger_account=self.fee_income)

    def _payload(self, **overrides) -> dict:
        payload = {
            "fee_structure": str(self.structure.pk),
            "fee_head": str(self.head.pk),
            "amount": "1500.00",
            "frequency": FeeFrequency.MONTHLY,
            "due_day": 10,
        }
        payload.update(overrides)
        return payload

    def test_a_monthly_line_is_created(self) -> None:
        response = self.client.post("/api/v1/fee-schedules", self._payload(), format="json")

        self.assertEqual(response.status_code, 201)

    def test_a_per_term_line_without_a_term_names_the_field(self) -> None:
        """The CHECK holds this too, but a constraint surfaces as a 409 naming
        an index. A school administrator filling in a form deserves the field."""
        response = self.client.post(
            "/api/v1/fee-schedules",
            self._payload(frequency=FeeFrequency.PER_TERM, due_day=None),
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("term", _fields(response))

    def test_a_line_cannot_be_added_to_an_active_structure(self) -> None:
        """Invoices have been priced from it; an edited schedule would silently
        disagree with every invoice already issued."""
        with tenant_context(self.tenant.id):
            FeeScheduleFactory(tenant=self.tenant, fee_structure=self.structure, fee_head=self.head)
        self.client.post(f"/api/v1/fee-structures/{self.structure.pk}:activate")

        with tenant_context(self.tenant.id):
            other_head = FeeHeadFactory(tenant=self.tenant, ledger_account=self.fee_income)

        response = self.client.post(
            "/api/v1/fee-schedules",
            self._payload(fee_head=str(other_head.pk)),
            format="json",
        )

        self.assertEqual(response.status_code, 422)

    def test_an_inactive_head_takes_no_new_pricing(self) -> None:
        with tenant_context(self.tenant.id):
            retired = FeeHeadFactory(
                tenant=self.tenant, ledger_account=self.fee_income, is_active=False
            )

        response = self.client.post(
            "/api/v1/fee-schedules", self._payload(fee_head=str(retired.pk)), format="json"
        )

        self.assertEqual(response.status_code, 400)

    def test_an_amount_beyond_the_money_column_is_refused(self) -> None:
        """A value that overflows would be a DataError from PostgreSQL in the
        middle of a batch rather than a 400 on the request that caused it."""
        response = self.client.post(
            "/api/v1/fee-schedules",
            self._payload(amount="99999999999.00"),
            format="json",
        )

        self.assertEqual(response.status_code, 400)


class PermissionAndFeatureTests(FeesFinanceAPITestCase):
    def test_a_caller_with_view_but_not_create_is_refused(self) -> None:
        reader = UserFactory(tenant=self.tenant)
        grant(reader, "fees.fee-structure.view")
        authenticate(self.client, reader)

        response = self.client.post(
            "/api/v1/fee-heads",
            {
                "name": "Tuition",
                "code": "T1",
                "category": "tuition",
                "ledger_account": str(self.fee_income.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)

    def test_reading_the_ledger_needs_the_ledger_key_not_the_structure_one(self) -> None:
        """§4 keeps these separate on purpose: a school administrator configures
        prices without being able to read the books."""
        configurer = UserFactory(tenant=self.tenant)
        grant(configurer, "fees.fee-structure.view", "fees.fee-structure.create")
        authenticate(self.client, configurer)

        response = self.client.get("/api/v1/ledger-entries")

        self.assertEqual(response.status_code, 403)

    def test_a_restricted_principal_is_refused_outright(self) -> None:
        """No portal-readable route ships in this PR. A chart of accounts has no
        per-family reading, so the guard is the whole answer rather than a
        record scope."""
        parent = UserFactory(tenant=self.tenant)
        grant(parent, "fees.fee-structure.view", is_restricted_principal=True)
        authenticate(self.client, parent)

        response = self.client.get("/api/v1/fee-heads")

        self.assertEqual(response.status_code, 403)

    def test_every_route_is_refused_when_the_module_is_off(self) -> None:
        disable_feature(self.tenant, FEATURE)

        for path in (
            "/api/v1/fee-heads",
            "/api/v1/fee-structures",
            "/api/v1/fee-schedules",
            "/api/v1/ledger-accounts",
            "/api/v1/ledger-entries",
        ):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 403)


class ManualJournalDecimalTests(FeesFinanceAPITestCase):
    def test_a_replayed_response_body_survives_json_encoding(self) -> None:
        """`Decimal` amounts reach the idempotency store as native types.

        `IdempotencyRecord.response_body` uses `DjangoJSONEncoder` precisely for
        this, and a money endpoint is where it first matters — so assert the
        serialized shape rather than trusting it.
        """
        response = self.client.post(
            "/api/v1/ledger-entries:post-journal",
            {
                "entry_date": "2026-09-01",
                "memo": "Float",
                "lines": [
                    {"ledger_account": str(self.cash.pk), "debit": "12.34"},
                    {"ledger_account": str(self.fee_income.pk), "credit": "12.34"},
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        amounts = {row["debit"] for row in response.json()["data"]}
        self.assertIn("12.34", amounts)
        self.assertNotIn(Decimal("12.34"), amounts)
