"""§13's reports, and the query counts that keep them usable.

The file header of `reports.py` states the intent; this is what enforces it. A
report that grew a query per student would still return the right answer, so
only a query count catches it — and the school most likely to notice is the
largest one, which is the one that can least afford a timeout.

The aging report gets the strictest assertion because it is the worst case: a
whole school's receivable ledger, bucketed. It is one query, and
`test_aging_is_one_query_regardless_of_how_many_invoices` compares two cohort
sizes so the assertion cannot be satisfied by a lucky constant.
"""

from __future__ import annotations

import datetime
from decimal import Decimal

from apps.fees_finance import reports, services
from apps.fees_finance.models import (
    Discount,
    FeeInvoice,
    Fine,
    Payment,
    PaymentMethod,
    Refund,
    Scholarship,
)
from apps.fees_finance.tests.base import FeesFinanceAPITestCase
from apps.fees_finance.tests.factories import (
    DiscountFactory,
    FeeHeadFactory,
    FeeInvoiceFactory,
    FeeInvoiceLineFactory,
    FineFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    UserFactory,
    fine_head,
)
from core.api.exceptions import DomainRuleViolation
from core.money import ZERO
from core.tenancy.context import tenant_context

TODAY = datetime.date(2026, 9, 30)


class ReportTestCase(FeesFinanceAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.head = FeeHeadFactory(tenant=self.tenant, ledger_account=self.fee_income)

    def _invoice(self, *, student=None, due, balance=Decimal("1000.00"), label="2026-09"):
        with tenant_context(self.tenant.id):
            invoice = FeeInvoiceFactory(
                tenant=self.tenant,
                student=student or self.student,
                academic_session=self.session,
                issue_date=datetime.date(2026, 9, 1),
                due_date=due,
                subtotal=balance,
                period_label=label,
                invoice_no=f"INV-{student.pk.hex[:6] if student else 'X'}-{label}",
            )
            FeeInvoiceLineFactory(
                tenant=self.tenant,
                fee_invoice=invoice,
                fee_head=self.head,
                amount=balance,
            )
        return invoice

    def _pay(self, invoice, amount, *, method=PaymentMethod.CASH):
        with tenant_context(self.tenant.id):
            return services.record_payment(
                invoice=invoice,
                amount=amount,
                method=method,
                reference_no="R-1" if method != PaymentMethod.CASH else None,
                gateway_provider=None,
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
            )


class CollectionReportTests(ReportTestCase):
    def test_collection_totals_by_day(self) -> None:
        invoice = self._invoice(due=datetime.date(2026, 9, 10))
        self._pay(invoice, Decimal("400.00"))
        self._pay(invoice, Decimal("100.00"))

        with tenant_context(self.tenant.id):
            rows = reports.collection_report(
                Payment.objects.alive(),
                date_from=datetime.date(2026, 1, 1),
                date_to=datetime.date(2027, 1, 1),
            )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["total"], Decimal("500.00"))
        self.assertEqual(rows[0]["count"], 2)

    def test_collection_can_group_by_method(self) -> None:
        invoice = self._invoice(due=datetime.date(2026, 9, 10))
        self._pay(invoice, Decimal("300.00"), method=PaymentMethod.CASH)
        self._pay(invoice, Decimal("200.00"), method=PaymentMethod.BANK_TRANSFER)

        with tenant_context(self.tenant.id):
            rows = {
                row["method"]: row["total"]
                for row in reports.collection_report(
                    Payment.objects.alive(),
                    date_from=datetime.date(2026, 1, 1),
                    date_to=datetime.date(2027, 1, 1),
                    group_by="method",
                )
            }

        self.assertEqual(rows["cash"], Decimal("300.00"))
        self.assertEqual(rows["bank_transfer"], Decimal("200.00"))

    def test_a_pending_payment_is_not_collection(self) -> None:
        """Money the school has not got. An accountant reconciling against a
        bank statement would spend the afternoon looking for it."""
        invoice = self._invoice(due=datetime.date(2026, 9, 10))
        with tenant_context(self.tenant.id):
            services.record_payment(
                invoice=invoice,
                amount=Decimal("400.00"),
                method=PaymentMethod.CASH,
                reference_no=None,
                gateway_provider=None,
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
                confirm=False,
            )
            rows = reports.collection_report(
                Payment.objects.alive(),
                date_from=datetime.date(2026, 1, 1),
                date_to=datetime.date(2027, 1, 1),
            )

        self.assertEqual(rows, [])

    def test_collection_is_one_query(self) -> None:
        invoice = self._invoice(due=datetime.date(2026, 9, 10))
        for _ in range(5):
            self._pay(invoice, Decimal("100.00"))

        with tenant_context(self.tenant.id), self.assertNumQueries(1):
            reports.collection_report(
                Payment.objects.alive(),
                date_from=datetime.date(2026, 1, 1),
                date_to=datetime.date(2027, 1, 1),
            )


class AgingReportTests(ReportTestCase):
    def test_balances_land_in_the_right_buckets(self) -> None:
        """§13.2's four buckets, measured from the due date."""
        self._invoice(due=TODAY - datetime.timedelta(days=10), label="a")
        self._invoice(due=TODAY - datetime.timedelta(days=45), label="b")
        self._invoice(due=TODAY - datetime.timedelta(days=75), label="c")
        self._invoice(due=TODAY - datetime.timedelta(days=200), label="d")

        with tenant_context(self.tenant.id):
            row = reports.outstanding_and_aging(FeeInvoice.objects.alive(), as_of=TODAY)[0]

        self.assertEqual(row["total_outstanding"], Decimal("4000.00"))
        self.assertEqual(row["bucket_0_30"], Decimal("1000.00"))
        self.assertEqual(row["bucket_31_60"], Decimal("1000.00"))
        self.assertEqual(row["bucket_61_90"], Decimal("1000.00"))
        self.assertEqual(row["bucket_90_plus"], Decimal("1000.00"))

    def test_an_invoice_not_yet_due_is_reported_separately(self) -> None:
        """It is outstanding but not overdue, and a defaulter list that mixed
        the two would chase families who are not late."""
        self._invoice(due=TODAY + datetime.timedelta(days=15), label="future")

        with tenant_context(self.tenant.id):
            row = reports.outstanding_and_aging(FeeInvoice.objects.alive(), as_of=TODAY)[0]

        self.assertEqual(row["not_yet_due"], Decimal("1000.00"))
        self.assertEqual(row["bucket_0_30"], ZERO)

    def test_a_settled_invoice_does_not_appear(self) -> None:
        """A zero balance is not an outstanding balance, and including it would
        put every paid-up family on the defaulter list at 0."""
        invoice = self._invoice(due=TODAY - datetime.timedelta(days=5))
        self._pay(invoice, Decimal("1000.00"))

        with tenant_context(self.tenant.id):
            rows = reports.outstanding_and_aging(FeeInvoice.objects.alive(), as_of=TODAY)

        self.assertEqual(rows, [])

    def test_a_canceled_invoice_does_not_appear(self) -> None:
        invoice = self._invoice(due=TODAY - datetime.timedelta(days=5))
        with tenant_context(self.tenant.id):
            services.cancel_invoice(
                invoice=invoice, reason="Wrong structure", actor_id=self.user.pk
            )
            rows = reports.outstanding_and_aging(FeeInvoice.objects.alive(), as_of=TODAY)

        self.assertEqual(rows, [])

    def test_aging_is_one_query_regardless_of_how_many_invoices(self) -> None:
        """The worst case in the module: a whole school's receivable ledger.

        Bucketed in SQL with one `CASE`, so the count does not move with the
        number of invoices. Asserted at two sizes so a lucky constant cannot
        satisfy it.
        """
        self._invoice(due=TODAY - datetime.timedelta(days=10), label="a")
        with tenant_context(self.tenant.id), self.assertNumQueries(1):
            reports.outstanding_and_aging(FeeInvoice.objects.alive(), as_of=TODAY)

        with tenant_context(self.tenant.id):
            for index in range(8):
                student = StudentFactory(tenant=self.tenant, campus=self.campus)
                StudentEnrollmentFactory(
                    tenant=self.tenant,
                    student=student,
                    academic_session=self.session,
                    school_class=self.school_class,
                    section=self.section,
                    enrollment_date=datetime.date(2026, 4, 1),
                )
                self._invoice(
                    student=student,
                    due=TODAY - datetime.timedelta(days=10 * index + 1),
                    label=f"m{index}",
                )

        with tenant_context(self.tenant.id), self.assertNumQueries(1):
            rows = reports.outstanding_and_aging(FeeInvoice.objects.alive(), as_of=TODAY)

        self.assertEqual(len(rows), 9)


class StudentLedgerTests(ReportTestCase):
    def test_a_statement_interleaves_charges_and_payments_with_a_running_balance(
        self,
    ) -> None:
        invoice = self._invoice(due=datetime.date(2026, 9, 10))
        self._pay(invoice, Decimal("400.00"))

        with tenant_context(self.tenant.id):
            rows = reports.student_ledger(
                student_id=self.student.pk,
                invoices=FeeInvoice.objects.alive(),
                payments=Payment.objects.alive(),
                refunds=Refund.objects.alive(),
            )

        self.assertEqual([row["kind"] for row in rows], ["invoice", "payment"])
        self.assertEqual(rows[0]["debit"], Decimal("1000.00"))
        self.assertEqual(rows[1]["credit"], Decimal("400.00"))
        self.assertEqual(rows[-1]["balance"], Decimal("600.00"))

    def test_a_processed_refund_appears_as_a_charge(self) -> None:
        """A refund puts the balance back up: the family owes it again."""
        invoice = self._invoice(due=datetime.date(2026, 9, 10))
        payment = self._pay(invoice, Decimal("1000.00"))
        approver = UserFactory(tenant=self.tenant)

        with tenant_context(self.tenant.id):
            refund = services.request_refund(
                payment=payment,
                amount=Decimal("250.00"),
                reason="Transport not used",
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
            )
            services.decide_refund(refund=refund, approve=True, note=None, actor_id=approver.pk)
            services.process_refund(
                refund=refund,
                method=PaymentMethod.CASH,
                reference_no=None,
                actor_id=approver.pk,
            )
            rows = reports.student_ledger(
                student_id=self.student.pk,
                invoices=FeeInvoice.objects.alive(),
                payments=Payment.objects.alive(),
                refunds=Refund.objects.alive(),
            )

        self.assertIn("refund", [row["kind"] for row in rows])
        self.assertEqual(rows[-1]["balance"], Decimal("250.00"))

    def test_another_student_s_events_are_absent(self) -> None:
        self._invoice(due=datetime.date(2026, 9, 10), label="mine")
        self._invoice(student=self.students[1], due=datetime.date(2026, 9, 10), label="theirs")

        with tenant_context(self.tenant.id):
            rows = reports.student_ledger(
                student_id=self.student.pk,
                invoices=FeeInvoice.objects.alive(),
                payments=Payment.objects.alive(),
                refunds=Refund.objects.alive(),
            )

        self.assertEqual(len(rows), 1)

    def test_a_canceled_invoice_is_not_on_the_statement(self) -> None:
        invoice = self._invoice(due=datetime.date(2026, 9, 10))
        with tenant_context(self.tenant.id):
            services.cancel_invoice(invoice=invoice, reason="Void", actor_id=self.user.pk)
            rows = reports.student_ledger(
                student_id=self.student.pk,
                invoices=FeeInvoice.objects.alive(),
                payments=Payment.objects.alive(),
                refunds=Refund.objects.alive(),
            )

        self.assertEqual(rows, [])


class GrantRegisterTests(ReportTestCase):
    def test_the_register_names_every_approver(self) -> None:
        """The report an auditor asks for first. A reduction nobody is recorded
        as having authorised is the finding, and the CHECKs on those tables
        exist so this column cannot come back blank."""
        with tenant_context(self.tenant.id):
            DiscountFactory(
                tenant=self.tenant,
                student=self.student,
                academic_session=self.session,
                approved_by=self.user.pk,
            )
            fine = FineFactory(
                tenant=self.tenant,
                student=self.student,
                fee_head=fine_head(self.tenant, self.fine_income),
            )
            services.waive_fine(fine=fine, reason="Returned", actor_id=self.user.pk)

            rows = reports.grant_and_waiver_register(
                discounts=Discount.objects.alive(),
                scholarships=Scholarship.objects.alive(),
                fines=Fine.objects.alive(),
            )

        kinds = {row["kind"] for row in rows}
        self.assertEqual(kinds, {"discount", "fine_waiver"})
        self.assertTrue(all(row["approved_by"] for row in rows))


class IncomeVsExpenseTests(ReportTestCase):
    def test_income_and_expense_are_reported_as_positive_figures(self) -> None:
        """ "Income: -50,000" is a report nobody reads correctly."""
        invoice = self._invoice(due=datetime.date(2026, 9, 10))
        self._pay(invoice, Decimal("1000.00"))

        with tenant_context(self.tenant.id):
            rows = {
                row["ledger_account__code"]: row
                for row in reports.income_vs_expense(
                    date_from=datetime.date(2026, 1, 1), date_to=datetime.date(2027, 1, 1)
                )
            }

        self.assertEqual(rows["4000"]["net"], Decimal("1000.00"))

    def test_asset_accounts_are_excluded(self) -> None:
        """Cash is neither income nor expense; including it would double the
        apparent income of every payment."""
        invoice = self._invoice(due=datetime.date(2026, 9, 10))
        self._pay(invoice, Decimal("1000.00"))

        with tenant_context(self.tenant.id):
            codes = {
                row["ledger_account__code"]
                for row in reports.income_vs_expense(
                    date_from=datetime.date(2026, 1, 1), date_to=datetime.date(2027, 1, 1)
                )
            }

        self.assertNotIn("1000", codes)

    def test_income_vs_expense_is_one_query(self) -> None:
        invoice = self._invoice(due=datetime.date(2026, 9, 10))
        for _ in range(4):
            self._pay(invoice, Decimal("100.00"))

        with tenant_context(self.tenant.id), self.assertNumQueries(1):
            reports.income_vs_expense(
                date_from=datetime.date(2026, 1, 1), date_to=datetime.date(2027, 1, 1)
            )


class ReportDispatchTests(ReportTestCase):
    def test_every_declared_kind_is_answerable(self) -> None:
        """A kind the endpoint advertises and cannot serve is worse than one it
        does not advertise, so the dispatch table is walked rather than trusted.
        """
        for kind in reports.REPORT_KINDS:
            with self.subTest(kind=kind), tenant_context(self.tenant.id):
                rows = services.build_report_rows(
                    kind=kind,
                    user=self.user,
                    date_from=datetime.date(2026, 1, 1),
                    date_to=datetime.date(2027, 1, 1),
                    student_id=self.student.pk if kind == "student-ledger" else None,
                )
                self.assertIsInstance(rows, list)

    def test_an_unknown_kind_is_refused(self) -> None:
        with (
            tenant_context(self.tenant.id),
            self.assertRaises(DomainRuleViolation),
        ):
            services.build_report_rows(
                kind="not-a-report",
                user=self.user,
                date_from=datetime.date(2026, 1, 1),
                date_to=datetime.date(2027, 1, 1),
            )

    def test_a_student_ledger_without_a_student_is_refused(self) -> None:
        with (
            tenant_context(self.tenant.id),
            self.assertRaises(DomainRuleViolation),
        ):
            services.build_report_rows(
                kind="student-ledger",
                user=self.user,
                date_from=datetime.date(2026, 1, 1),
                date_to=datetime.date(2027, 1, 1),
            )


class ReportEndpointTests(ReportTestCase):
    def test_the_summary_endpoint_serves_inline_under_the_cap(self) -> None:
        invoice = self._invoice(due=datetime.date(2026, 9, 10))
        self._pay(invoice, Decimal("500.00"))

        response = self.client.get(
            "/api/v1/reports/finance-summary"
            "?kind=collection&date_from=2026-01-01&date_to=2027-01-01"
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["meta"]["kind"], "collection")
        self.assertEqual(body["meta"]["row_count"], 1)

    def test_the_meta_is_not_nested_inside_data(self) -> None:
        """`EnvelopeJSONRenderer` passes a pre-shaped `{data, meta}` through
        untouched, so the view returns a bare `Response` rather than
        `ActionResponse.ok` — wrapping it again would nest `meta` in `data`."""
        response = self.client.get(
            "/api/v1/reports/finance-summary"
            "?kind=trial-balance&date_from=2026-01-01&date_to=2027-01-01"
        )

        body = response.json()
        self.assertIn("meta", body)
        self.assertNotIn("meta", body.get("data", {}))

    def test_an_unknown_kind_is_a_field_error(self) -> None:
        response = self.client.get(
            "/api/v1/reports/finance-summary?kind=nope&date_from=2026-01-01&date_to=2027-01-01"
        )

        self.assertEqual(response.status_code, 400)

    def test_a_reversed_period_is_refused(self) -> None:
        response = self.client.get(
            "/api/v1/reports/finance-summary"
            "?kind=collection&date_from=2027-01-01&date_to=2026-01-01"
        )

        self.assertEqual(response.status_code, 400)

    def test_an_export_returns_202_and_a_job(self) -> None:
        response = self.client.post(
            "/api/v1/reports/finance-summary",
            {
                "kind": "outstanding-aging",
                "date_from": "2026-01-01",
                "date_to": "2027-01-01",
                "format": "csv",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 202)
        self.assertIn("job_id", response.json()["data"])

    def test_the_export_job_carries_the_requester_for_scope_recomputation(self) -> None:
        """An export must not widen what its requester could see inline, which
        it would if the job re-queried without the record scope."""
        from core.jobs.models import BackgroundJob

        self.client.post(
            "/api/v1/reports/finance-summary",
            {"kind": "collection", "date_from": "2026-01-01", "date_to": "2027-01-01"},
            format="json",
        )

        with tenant_context(self.tenant.id):
            job = BackgroundJob.objects.get(job_type="fees.export-report")

        self.assertEqual(job.payload["requested_by"], str(self.user.pk))

    def test_the_report_endpoint_needs_the_report_key(self) -> None:
        """§4 keeps reporting separate from the ledger and from configuration: a
        principal reads summaries for oversight without holding any write key."""
        from apps.fees_finance.tests.factories import authenticate, grant

        reader = UserFactory(tenant=self.tenant)
        grant(reader, "fees.invoice.view")
        authenticate(self.client, reader)

        response = self.client.get(
            "/api/v1/reports/finance-summary"
            "?kind=collection&date_from=2026-01-01&date_to=2027-01-01"
        )

        self.assertEqual(response.status_code, 403)


class StudentLedgerEndpointTests(ReportTestCase):
    def test_a_guardian_reads_their_own_child_s_statement(self) -> None:
        from apps.fees_finance.tests.factories import authenticate, grant

        invoice = self._invoice(due=datetime.date(2026, 9, 10))
        self._pay(invoice, Decimal("400.00"))
        grant(
            self.guardian_user,
            "fees.invoice.view",
            scope="own",
            is_restricted_principal=True,
        )
        authenticate(self.client, self.guardian_user)

        response = self.client.get(f"/api/v1/students/{self.student.pk}/ledger")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["meta"]["closing_balance"], "600.00")

    def test_a_guardian_cannot_read_another_family_s_statement(self) -> None:
        """Record scope through the same `build_report_rows` the staff endpoint
        uses — an empty statement rather than another family's figures."""
        from apps.fees_finance.tests.factories import authenticate, grant

        self._invoice(student=self.students[1], due=datetime.date(2026, 9, 10), label="theirs")
        grant(
            self.guardian_user,
            "fees.invoice.view",
            scope="own",
            is_restricted_principal=True,
        )
        authenticate(self.client, self.guardian_user)

        response = self.client.get(f"/api/v1/students/{self.students[1].pk}/ledger")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"], [])
