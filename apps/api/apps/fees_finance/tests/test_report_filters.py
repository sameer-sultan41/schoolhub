"""§13's campus, session and class filters, and the typed report rows.

One fixture shape carries every case: **student A** (campus A, class A, enrolled in
the current session) and **student B** (campus B, class B, same session), plus an
older session in which A was in class B. Three invoices follow from that, each paid a
different amount so a total identifies exactly which rows a filter let through:

| invoice | student | session | class | paid |
| ------- | ------- | ------- | ----- | ---- |
| `inv_a`   | A | current | A | 100 |
| `inv_b`   | B | current | B | 200 |
| `inv_old` | A | older   | B | 400 |

Every assertion is on the endpoint, since the filters are query parameters: the
service is only as correct as the way the serializer hands it the ids.
"""

from __future__ import annotations

import datetime
import json
from decimal import Decimal
from unittest import mock

from apps.fees_finance import reports, services
from apps.fees_finance.models import BudgetStatus, ExpenseStatus, PaymentMethod
from apps.fees_finance.report_serializers import REPORT_ROW_SERIALIZERS
from apps.fees_finance.tests import test_reports
from apps.fees_finance.tests.factories import (
    AcademicSessionFactory,
    BudgetFactory,
    CampusFactory,
    ClassFactory,
    DiscountFactory,
    ExpenseCategoryFactory,
    ExpenseFactory,
    FeeInvoiceFactory,
    FeeInvoiceLineFactory,
    FineFactory,
    ScholarshipFactory,
    SectionFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    TenantFactory,
    expense_account,
    fine_head,
)
from core.tenancy.context import tenant_context

URL = "/api/v1/reports/finance-summary"
WINDOW = {"date_from": "2026-01-01", "date_to": "2030-01-01"}


class ReportFilterTestCase(test_reports.ReportTestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.campus_b = CampusFactory(tenant=self.tenant)
            self.class_b = ClassFactory(tenant=self.tenant, level=9)
            section_b = SectionFactory(
                tenant=self.tenant, school_class=self.class_b, campus=self.campus_b
            )
            self.session_old = AcademicSessionFactory(
                tenant=self.tenant,
                is_current=False,
                start_date=datetime.date(2025, 4, 1),
                end_date=datetime.date(2026, 3, 31),
            )
            self.student_a = self.students[0]
            self.student_b = StudentFactory(tenant=self.tenant, campus=self.campus_b)
            self.enrollment_a = self.enrollments[0]
            self.enrollment_b = StudentEnrollmentFactory(
                tenant=self.tenant,
                student=self.student_b,
                academic_session=self.session,
                school_class=self.class_b,
                section=section_b,
                enrollment_date=datetime.date(2026, 4, 1),
            )
            self.enrollment_old = StudentEnrollmentFactory(
                tenant=self.tenant,
                student=self.student_a,
                academic_session=self.session_old,
                school_class=self.class_b,
                section=section_b,
                enrollment_date=datetime.date(2025, 4, 1),
            )
        self.inv_a = self._billed(self.student_a, self.session, self.enrollment_a, "a")
        self.inv_b = self._billed(self.student_b, self.session, self.enrollment_b, "b")
        self.inv_old = self._billed(self.student_a, self.session_old, self.enrollment_old, "old")
        self._pay(self.inv_a, Decimal("100.00"))
        self._pay(self.inv_b, Decimal("200.00"))
        self._pay(self.inv_old, Decimal("400.00"))

    def _billed(self, student, session, enrollment, label):
        with tenant_context(self.tenant.id):
            invoice = FeeInvoiceFactory(
                tenant=self.tenant,
                student=student,
                student_enrollment=enrollment,
                academic_session=session,
                issue_date=datetime.date(2026, 8, 1),
                due_date=datetime.date(2026, 9, 10),
                subtotal=Decimal("1000.00"),
                period_label=label,
                invoice_no=f"INV-F-{label}",
            )
            FeeInvoiceLineFactory(
                tenant=self.tenant,
                fee_invoice=invoice,
                fee_head=self.head,
                amount=Decimal("1000.00"),
            )
        return invoice

    def rows(self, kind: str, **params) -> list[dict]:
        response = self.client.get(URL, {"kind": kind, **WINDOW, **params})
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["data"]


class FilterMatrixMixin:
    """Each kind runs the same six filter cases against its own expected survivors."""

    def assert_filters(self, kind: str, expected: dict[str, set], read, **extra) -> None:
        ids = {
            "campus_a": ("campus_id", lambda s: s.campus.pk),
            "campus_b": ("campus_id", lambda s: s.campus_b.pk),
            "session_a": ("academic_session_id", lambda s: s.session.pk),
            "session_b": ("academic_session_id", lambda s: s.session_old.pk),
            "class_a": ("class_id", lambda s: s.school_class.pk),
            "class_b": ("class_id", lambda s: s.class_b.pk),
        }
        for case, (param, resolve) in ids.items():
            with self.subTest(kind=kind, filter=case):  # type: ignore[attr-defined]
                rows = self.rows(kind, **{param: resolve(self)}, **extra)  # type: ignore[attr-defined]
                self.assertEqual(read(rows), expected[case])  # type: ignore[attr-defined]


class CollectionFilterTests(FilterMatrixMixin, ReportFilterTestCase):
    def test_each_filter_keeps_only_its_payments(self) -> None:
        def total(rows):
            return {Decimal(row["total"]) for row in rows}

        self.assertEqual(total(self.rows("collection")), {Decimal("700.00")})
        self.assert_filters(
            "collection",
            {
                "campus_a": {Decimal("500.00")},
                "campus_b": {Decimal("200.00")},
                "session_a": {Decimal("300.00")},
                "session_b": {Decimal("400.00")},
                "class_a": {Decimal("100.00")},
                "class_b": {Decimal("600.00")},
            },
            total,
        )

    def test_filters_combine_as_an_and(self) -> None:
        rows = self.rows(
            "collection",
            campus_id=self.campus.pk,
            academic_session_id=self.session_old.pk,
        )

        self.assertEqual([Decimal(row["total"]) for row in rows], [Decimal("400.00")])

    def test_a_filter_leaves_no_row_when_nothing_matches(self) -> None:
        self.assertEqual(
            self.rows("collection", campus_id=self.campus_b.pk, class_id=self.school_class.pk), []
        )


class AgingFilterTests(FilterMatrixMixin, ReportFilterTestCase):
    def test_each_filter_keeps_only_its_invoices(self) -> None:
        a, b = str(self.student_a.pk), str(self.student_b.pk)

        def by_student(rows):
            return {row["student_id"]: Decimal(row["total_outstanding"]) for row in rows}

        # A owes 900 + 600 on its two invoices; B owes 800.
        self.assertEqual(
            by_student(self.rows("outstanding-aging")),
            {
                a: Decimal("1500.00"),
                b: Decimal("800.00"),
            },
        )
        self.assert_filters(
            "outstanding-aging",
            {
                "campus_a": {a: Decimal("1500.00")},
                "campus_b": {b: Decimal("800.00")},
                "session_a": {a: Decimal("900.00"), b: Decimal("800.00")},
                "session_b": {a: Decimal("600.00")},
                "class_a": {a: Decimal("900.00")},
                "class_b": {a: Decimal("600.00"), b: Decimal("800.00")},
            },
            by_student,
        )


class StudentLedgerFilterTests(FilterMatrixMixin, ReportFilterTestCase):
    def test_each_filter_keeps_only_its_lines(self) -> None:
        def credits(rows):
            return {Decimal(row["credit"]) for row in rows if row["entry_type"] == "payment"}

        def lines(rows):
            return len(rows)

        student = {"student": str(self.student_a.pk)}
        self.assertEqual(lines(self.rows("student-ledger", **student)), 4)
        self.assert_filters(
            "student-ledger",
            {
                "campus_a": {Decimal("100.00"), Decimal("400.00")},
                "campus_b": set(),
                "session_a": {Decimal("100.00")},
                "session_b": {Decimal("400.00")},
                "class_a": {Decimal("100.00")},
                "class_b": {Decimal("400.00")},
            },
            credits,
            **student,
        )

    def test_a_filtered_statement_keeps_its_own_running_balance(self) -> None:
        rows = self.rows(
            "student-ledger",
            student=str(self.student_a.pk),
            academic_session_id=self.session_old.pk,
        )

        self.assertEqual(rows[-1]["balance"], "600.00")


class GrantRegisterFilterTests(FilterMatrixMixin, ReportFilterTestCase):
    def setUp(self) -> None:
        super().setUp()
        head = fine_head(self.tenant, self.fine_income)
        with tenant_context(self.tenant.id):
            for student, session, value in (
                (self.student_a, self.session, "11.00"),
                (self.student_b, self.session, "13.00"),
                (self.student_a, self.session_old, "12.00"),
            ):
                DiscountFactory(
                    tenant=self.tenant,
                    student=student,
                    academic_session=session,
                    value=Decimal(value),
                    approved_by=self.user.pk,
                )
            for student, value in ((self.student_a, "21.00"), (self.student_b, "22.00")):
                ScholarshipFactory(
                    tenant=self.tenant,
                    student=student,
                    academic_session=self.session,
                    value=Decimal(value),
                    approved_by=self.user.pk,
                )
            for student, amount in ((self.student_a, "31.00"), (self.student_b, "32.00")):
                fine = FineFactory(
                    tenant=self.tenant, student=student, fee_head=head, amount=Decimal(amount)
                )
                services.waive_fine(fine=fine, reason="Returned", actor_id=self.user.pk)

    def test_each_filter_keeps_only_its_grants(self) -> None:
        def values(rows):
            return {Decimal(row["value"]) for row in rows}

        def dec(*items: str) -> set[Decimal]:
            return {Decimal(item) for item in items}

        self.assertEqual(
            values(self.rows("grant-register")),
            dec("11", "12", "13", "21", "22", "31", "32"),
        )
        # Discounts and scholarships by their own session; a fine has none, so it is
        # in a session or class when its student is enrolled there.
        self.assert_filters(
            "grant-register",
            {
                "campus_a": dec("11", "12", "21", "31"),
                "campus_b": dec("13", "22", "32"),
                "session_a": dec("11", "13", "21", "22", "31", "32"),
                "session_b": dec("12", "31"),
                "class_a": dec("11", "21", "31"),
                "class_b": dec("12", "13", "22", "31", "32"),
            },
            values,
        )


class ExpenseRegisterFilterTests(ReportFilterTestCase):
    def test_campus_keeps_only_that_campus_s_expenses(self) -> None:
        account = expense_account(self.tenant, code="5100", name="Utilities")
        with tenant_context(self.tenant.id):
            category = ExpenseCategoryFactory(tenant=self.tenant, ledger_account=account)
            for campus, amount in (
                (self.campus, "10.00"),
                (self.campus_b, "20.00"),
                (None, "30.00"),
            ):
                ExpenseFactory(
                    tenant=self.tenant,
                    expense_category=category,
                    campus=campus,
                    amount=Decimal(amount),
                    created_by=self.user.pk,
                    payment_method=PaymentMethod.CASH,
                )

        def amounts(**params):
            return {Decimal(row["amount"]) for row in self.rows("expense-register", **params)}

        self.assertEqual(amounts(), {Decimal("10.00"), Decimal("20.00"), Decimal("30.00")})
        self.assertEqual(amounts(campus_id=self.campus.pk), {Decimal("10.00")})
        self.assertEqual(amounts(campus_id=self.campus_b.pk), {Decimal("20.00")})


class IllegalFilterTests(ReportFilterTestCase):
    def test_a_filter_the_kind_has_no_dimension_for_is_a_field_error(self) -> None:
        illegal = [
            ("trial-balance", "campus_id"),
            ("trial-balance", "academic_session_id"),
            ("income-vs-expense", "class_id"),
            ("budget-variance", "campus_id"),
            ("expense-register", "academic_session_id"),
            ("expense-register", "class_id"),
        ]
        for kind, param in illegal:
            with self.subTest(kind=kind, param=param):
                response = self.client.get(
                    URL, {"kind": kind, **WINDOW, param: str(self.campus.pk)}
                )

                self.assertEqual(response.status_code, 400)
                self.assertIn(param, json.dumps(response.json()))

    def test_a_filter_is_refused_on_the_export_too(self) -> None:
        response = self.client.post(
            URL,
            {"kind": "trial-balance", **WINDOW, "campus_id": str(self.campus.pk)},
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_a_malformed_id_is_a_field_error(self) -> None:
        response = self.client.get(URL, {"kind": "collection", **WINDOW, "campus_id": "nope"})

        self.assertEqual(response.status_code, 400)


class CrossTenantFilterTests(ReportFilterTestCase):
    def test_another_tenant_s_ids_filter_to_nothing(self) -> None:
        """Under RLS a foreign id matches no row, so a report filtered by one is
        empty — never the caller's own rows, and never a different status that
        would confirm the id exists."""
        other = TenantFactory()
        with tenant_context(other.id):
            foreign = {
                "campus_id": CampusFactory(tenant=other).pk,
                "academic_session_id": AcademicSessionFactory(tenant=other).pk,
                "class_id": ClassFactory(tenant=other).pk,
            }
        student = {"student": str(self.student_a.pk)}

        for kind in ("collection", "outstanding-aging", "student-ledger", "grant-register"):
            for param, value in foreign.items():
                with self.subTest(kind=kind, param=param):
                    extra = student if kind == "student-ledger" else {}
                    self.assertEqual(self.rows(kind, **{param: value}, **extra), [])
        self.assertEqual(self.rows("expense-register", campus_id=foreign["campus_id"]), [])


class RowLimitTests(ReportFilterTestCase):
    def test_the_inline_ceiling_still_answers_422_with_the_limit_under_a_filter(self) -> None:
        self._pay(self.inv_a, Decimal("50.00"), method=PaymentMethod.BANK_TRANSFER)

        with mock.patch.object(services, "SYNCHRONOUS_REPORT_ROW_LIMIT", 1):
            response = self.client.get(
                URL,
                {"kind": "collection", **WINDOW, "group_by": "method", "campus_id": self.campus.pk},
            )

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["meta"], {"row_limit": 1})

    def test_the_export_job_carries_the_filters(self) -> None:
        from core.jobs.models import BackgroundJob

        self.client.post(
            URL,
            {
                "kind": "collection",
                **WINDOW,
                "campus_id": str(self.campus.pk),
                "academic_session_id": str(self.session.pk),
                "class_id": str(self.school_class.pk),
            },
            format="json",
        )

        with tenant_context(self.tenant.id):
            job = BackgroundJob.objects.get(job_type="fees.export-report")
        self.assertEqual(
            reports.ReportFilters.from_payload(job.payload),
            reports.ReportFilters(
                campus_id=self.campus.pk,
                academic_session_id=self.session.pk,
                class_id=self.school_class.pk,
            ),
        )


class TypedRowTests(ReportFilterTestCase):
    def setUp(self) -> None:
        super().setUp()
        account = expense_account(self.tenant, code="5100", name="Utilities")
        with tenant_context(self.tenant.id):
            category = ExpenseCategoryFactory(tenant=self.tenant, ledger_account=account)
            ExpenseFactory(
                tenant=self.tenant,
                expense_category=category,
                campus=self.campus,
                created_by=self.user.pk,
                payment_method=PaymentMethod.CASH,
                status=ExpenseStatus.DRAFT,
            )
            BudgetFactory(
                tenant=self.tenant,
                ledger_account=account,
                status=BudgetStatus.APPROVED,
                approved_by=self.user.pk,
            )
        with tenant_context(self.tenant.id):
            DiscountFactory(
                tenant=self.tenant,
                student=self.student_a,
                academic_session=self.session,
                approved_by=self.user.pk,
            )

    def test_every_report_kind_has_a_row_serializer_and_a_filter_rule(self) -> None:
        self.assertEqual(set(REPORT_ROW_SERIALIZERS), set(reports.REPORT_KINDS))
        self.assertEqual(set(reports.REPORT_FILTERS_BY_KIND), set(reports.REPORT_KINDS))

    def test_each_kind_sends_exactly_its_declared_fields(self) -> None:
        for kind, serializer in REPORT_ROW_SERIALIZERS.items():
            with self.subTest(kind=kind):
                extra = {"student": str(self.student_a.pk)} if kind == "student-ledger" else {}
                rows = self.rows(kind, **extra)

                self.assertTrue(rows, f"{kind} returned no rows to check")
                for row in rows:
                    self.assertEqual(set(row), set(serializer().fields))
                    self.assertEqual(row["kind"], kind)

    def test_money_is_a_two_decimal_string(self) -> None:
        row = self.rows("outstanding-aging")[0]

        for field in ("total_outstanding", "not_yet_due", "bucket_0_30", "bucket_90_plus"):
            self.assertRegex(row[field], r"^-?\d+\.\d{2}$")

    def test_a_collection_row_carries_only_the_key_it_was_grouped_by(self) -> None:
        by_method = self.rows("collection", group_by="method")[0]
        by_cashier = self.rows("collection", group_by="cashier")[0]
        by_day = self.rows("collection")[0]

        self.assertEqual(
            (by_method["method"], by_method["day"], by_method["received_by"]),
            ("cash", None, None),
        )
        self.assertEqual(by_cashier["received_by"], str(self.user.pk))
        self.assertIsNone(by_cashier["method"])
        self.assertIsNotNone(by_day["day"])

    def test_a_statement_line_keeps_its_own_type_beside_the_discriminator(self) -> None:
        rows = self.rows("student-ledger", student=str(self.student_a.pk))

        self.assertEqual({row["entry_type"] for row in rows}, {"invoice", "payment"})
        self.assertEqual({row["kind"] for row in rows}, {"student-ledger"})

    def test_the_statement_endpoint_is_typed_and_closes_on_the_server_balance(self) -> None:
        response = self.client.get(f"/api/v1/students/{self.student_a.pk}/ledger")

        body = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            set(body["data"][0]),
            {"date", "kind", "reference", "description", "debit", "credit", "balance"},
        )
        self.assertEqual(body["meta"], {"row_count": 4, "closing_balance": "1500.00"})
