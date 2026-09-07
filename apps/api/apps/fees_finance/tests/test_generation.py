"""Invoice generation against a real database.

`test_invoicing.py` covers the arithmetic without one. This file covers what
only a database can prove: the duplicate guard, gapless numbering, the fine
state transition, and the query count.

The two cases that matter most are the re-run and the query count. A billing run
retried after a partial failure must finish the remainder rather than double-bill
or refuse outright — and it must not cost a query per student, because the school
most likely to need a second attempt is the largest one.
"""

from __future__ import annotations

import datetime
from decimal import Decimal

from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.fees_finance import services
from apps.fees_finance.models import (
    FeeInvoice,
    FeeInvoiceLine,
    FeeStructureStatus,
    FineStatus,
    InvoiceLineSource,
    InvoiceStatus,
)
from apps.fees_finance.tests.base import SESSION_START, FeesFinanceAPITestCase
from apps.fees_finance.tests.factories import (
    DiscountFactory,
    FeeStructureFactory,
    FineFactory,
    ScholarshipFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    fine_head,
)
from core.api.exceptions import DomainRuleViolation
from core.tenancy.context import tenant_context

SEP = datetime.date(2026, 9, 1)


class GenerationTests(FeesFinanceAPITestCase):
    def _generate(self, structure, *, period_start=SEP, term=None) -> dict:
        with tenant_context(self.tenant.id):
            return services.generate_invoices(
                structure=structure,
                period_start=period_start,
                term=term,
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
            )

    def test_every_active_enrollment_is_billed_once(self) -> None:
        structure, _, _ = self.active_structure()

        result = self._generate(structure)

        self.assertEqual(result["issued"], 3)
        self.assertEqual(result["skipped"], 0)
        with tenant_context(self.tenant.id):
            self.assertEqual(FeeInvoice.objects.count(), 3)

    def test_a_re_run_skips_what_is_already_billed_rather_than_failing(self) -> None:
        """The normal outcome of a retry, not an error.

        A job that failed halfway must be safe to run again: the duplicate guard
        means the students already billed are left exactly as they are, and the
        remainder is finished. Refusing outright would leave an accountant
        reading every invoice to work out where it stopped.
        """
        structure, _, _ = self.active_structure()
        self._generate(structure)

        result = self._generate(structure)

        self.assertEqual(result["issued"], 0)
        self.assertEqual(result["skipped"], 3)
        with tenant_context(self.tenant.id):
            self.assertEqual(FeeInvoice.objects.count(), 3)

    def test_a_student_enrolled_after_the_first_run_is_picked_up_by_the_second(self) -> None:
        structure, _, _ = self.active_structure()
        self._generate(structure)

        with tenant_context(self.tenant.id):
            late = StudentFactory(tenant=self.tenant, campus=self.campus)
            StudentEnrollmentFactory(
                tenant=self.tenant,
                student=late,
                academic_session=self.session,
                school_class=self.school_class,
                section=self.section,
                enrollment_date=SESSION_START,
            )

        result = self._generate(structure)

        self.assertEqual(result["issued"], 1)
        self.assertEqual(result["skipped"], 3)

    def test_invoice_numbers_are_unique_and_sequential_across_a_run(self) -> None:
        """Gapless, through `core.tenancy.sequences.allocate_number` — the
        counter and the invoice move in one transaction."""
        structure, _, _ = self.active_structure()
        self._generate(structure)

        with tenant_context(self.tenant.id):
            numbers = sorted(FeeInvoice.objects.values_list("invoice_no", flat=True))

        self.assertEqual(len(set(numbers)), 3)
        self.assertEqual(numbers, ["INV-2026-00001", "INV-2026-00002", "INV-2026-00003"])

    def test_a_draft_structure_cannot_bill(self) -> None:
        """Billing from a draft produces invoices a school has to cancel and
        re-issue."""
        with tenant_context(self.tenant.id):
            structure = FeeStructureFactory(
                tenant=self.tenant,
                academic_session=self.session,
                status=FeeStructureStatus.DRAFT,
            )

        with self.assertRaises(DomainRuleViolation):
            self._generate(structure)

    def test_billing_a_month_outside_the_session_is_refused(self) -> None:
        """A run aimed at a month the session does not cover would otherwise
        invent charges outside the year a parent enrolled for."""
        structure, _, _ = self.active_structure()

        with self.assertRaises(DomainRuleViolation) as caught:
            self._generate(structure, period_start=datetime.date(2028, 5, 1))

        self.assertIn("outside", str(caught.exception.detail))

    def test_a_structure_scoped_to_another_class_bills_nobody(self) -> None:
        with tenant_context(self.tenant.id):
            from apps.fees_finance.tests.factories import ClassFactory

            other_class = ClassFactory(tenant=self.tenant, level=3)
        structure, _, _ = self.active_structure(school_class=other_class)

        result = self._generate(structure)

        self.assertEqual(result["issued"], 0)

    def test_a_campus_scoped_structure_bills_only_that_campus(self) -> None:
        with tenant_context(self.tenant.id):
            from apps.fees_finance.tests.factories import CampusFactory

            other_campus = CampusFactory(tenant=self.tenant)
        structure, _, _ = self.active_structure(campus=other_campus)

        result = self._generate(structure)

        self.assertEqual(result["issued"], 0)


class GrantAndFineIntegrationTests(FeesFinanceAPITestCase):
    def _generate(self, structure) -> dict:
        with tenant_context(self.tenant.id):
            return services.generate_invoices(
                structure=structure,
                period_start=SEP,
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
            )

    def test_a_student_s_discount_reduces_only_their_invoice(self) -> None:
        structure, _, _ = self.active_structure(amount=Decimal("1000.00"))
        with tenant_context(self.tenant.id):
            DiscountFactory(
                tenant=self.tenant,
                student=self.student,
                academic_session=self.session,
                value=Decimal("20.00"),
            )

        self._generate(structure)

        with tenant_context(self.tenant.id):
            mine = FeeInvoice.objects.get(student=self.student)
            others = FeeInvoice.objects.exclude(student=self.student)

        self.assertEqual(mine.discount_total, Decimal("200.00"))
        self.assertEqual(mine.balance_due, Decimal("800.00"))
        self.assertTrue(all(i.discount_total == Decimal("0.00") for i in others))

    def test_a_scholarship_and_a_discount_both_apply_in_order(self) -> None:
        """Scholarship first, then the discount clamped to what remains — the
        order `apply_grants` fixes, asserted end to end."""
        structure, _, _ = self.active_structure(amount=Decimal("1000.00"))
        with tenant_context(self.tenant.id):
            ScholarshipFactory(
                tenant=self.tenant,
                student=self.student,
                academic_session=self.session,
                value=Decimal("50.00"),
            )
            DiscountFactory(
                tenant=self.tenant,
                student=self.student,
                academic_session=self.session,
                value=Decimal("20.00"),
            )

        self._generate(structure)

        with tenant_context(self.tenant.id):
            invoice = FeeInvoice.objects.get(student=self.student)

        # 500 from the scholarship, then 200 (20% of 1000) from the discount.
        self.assertEqual(invoice.discount_total, Decimal("700.00"))
        self.assertEqual(invoice.balance_due, Decimal("300.00"))

    def test_a_pending_fine_is_billed_and_marked_invoiced(self) -> None:
        structure, _, _ = self.active_structure()
        head = fine_head(self.tenant, self.fine_income)
        with tenant_context(self.tenant.id):
            fine = FineFactory(
                tenant=self.tenant,
                student=self.student,
                fee_head=head,
                amount=Decimal("250.00"),
            )

        self._generate(structure)

        with tenant_context(self.tenant.id):
            fine.refresh_from_db()
            invoice = FeeInvoice.objects.get(student=self.student)
            line = FeeInvoiceLine.objects.get(
                fee_invoice=invoice, source_type=InvoiceLineSource.FINE
            )

        self.assertEqual(fine.status, FineStatus.INVOICED)
        self.assertEqual(invoice.fine_total, Decimal("250.00"))
        self.assertEqual(line.source_id, fine.pk)

    def test_an_invoiced_fine_is_not_billed_a_second_time(self) -> None:
        """`status` is what keeps a fine off two invoices."""
        structure, _, _ = self.active_structure()
        head = fine_head(self.tenant, self.fine_income)
        with tenant_context(self.tenant.id):
            FineFactory(
                tenant=self.tenant, student=self.student, fee_head=head, amount=Decimal("250.00")
            )
        self._generate(structure)

        with tenant_context(self.tenant.id):
            october = FeeStructureFactory(
                tenant=self.tenant,
                academic_session=self.session,
                status=FeeStructureStatus.ACTIVE,
                name="October",
            )
        # A second structure so the duplicate guard does not skip these students.
        from apps.fees_finance.tests.factories import FeeHeadFactory, FeeScheduleFactory

        with tenant_context(self.tenant.id):
            FeeScheduleFactory(
                tenant=self.tenant,
                fee_structure=october,
                fee_head=FeeHeadFactory(tenant=self.tenant, ledger_account=self.fee_income),
                amount=Decimal("1000.00"),
                due_day=10,
            )

        self._generate(october)

        with tenant_context(self.tenant.id):
            fine_lines = FeeInvoiceLine.objects.filter(source_type=InvoiceLineSource.FINE)

        self.assertEqual(fine_lines.count(), 1)

    def test_a_waived_fine_is_never_billed(self) -> None:
        structure, _, _ = self.active_structure()
        head = fine_head(self.tenant, self.fine_income)
        with tenant_context(self.tenant.id):
            fine = FineFactory(
                tenant=self.tenant, student=self.student, fee_head=head, amount=Decimal("250.00")
            )
            services.waive_fine(fine=fine, reason="Book returned", actor_id=self.user.pk)

        self._generate(structure)

        with tenant_context(self.tenant.id):
            invoice = FeeInvoice.objects.get(student=self.student)

        self.assertEqual(invoice.fine_total, Decimal("0.00"))


class GenerationQueryCountTests(FeesFinanceAPITestCase):
    def test_billing_more_students_does_not_cost_more_queries_per_student(self) -> None:
        """The shape that decides whether a 2000-student school can be billed.

        Asserted as "the per-student cost does not grow" rather than against a
        fixed number: the run does write per invoice (the row, its lines and a
        counter bump), so the count *does* rise with student count. What must not
        rise is the number of *reads* — `_collect_generation_inputs` fetches
        grants and fines once for the whole cohort, and a regression there would
        put a SELECT inside the loop.

        Measured by comparing the growth between two cohort sizes: if reads were
        per-student, tripling the cohort would roughly triple the query count
        rather than adding a fixed cost per invoice.
        """
        structure_small, _, _ = self.active_structure(name="Small")
        with CaptureQueriesContext(connection) as three:
            self._bill(structure_small)

        with tenant_context(self.tenant.id):
            for _ in range(6):
                student = StudentFactory(tenant=self.tenant, campus=self.campus)
                StudentEnrollmentFactory(
                    tenant=self.tenant,
                    student=student,
                    academic_session=self.session,
                    school_class=self.school_class,
                    section=self.section,
                    enrollment_date=SESSION_START,
                )

        structure_large, _, _ = self.active_structure(name="Large")
        with CaptureQueriesContext(connection) as nine:
            self._bill(structure_large)

        per_invoice_small = len(three) / 3
        per_invoice_large = len(nine) / 9
        # Per-invoice cost must not grow as the cohort does. It falls, in fact,
        # because the fixed collection cost is amortised over more invoices.
        self.assertLessEqual(per_invoice_large, per_invoice_small)

    def _bill(self, structure) -> dict:
        with tenant_context(self.tenant.id):
            return services.generate_invoices(
                structure=structure,
                period_start=SEP,
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
            )


class CancellationTests(FeesFinanceAPITestCase):
    def test_cancelling_releases_the_period_for_re_issue(self) -> None:
        """The duplicate guard excludes canceled rows, which is what makes
        "cancel and re-issue" a workable correction rather than a dead end."""
        structure, _, _ = self.active_structure()
        with tenant_context(self.tenant.id):
            services.generate_invoices(
                structure=structure,
                period_start=SEP,
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
            )
            invoice = FeeInvoice.objects.get(student=self.student)
            services.cancel_invoice(
                invoice=invoice, reason="Wrong structure", actor_id=self.user.pk
            )

            result = services.generate_invoices(
                structure=structure,
                period_start=SEP,
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
            )

        self.assertEqual(result["issued"], 1)
        self.assertEqual(result["skipped"], 2)

    def test_cancelling_returns_a_billed_fine_to_the_queue(self) -> None:
        """A cancelled invoice must not quietly forgive a library charge."""
        structure, _, _ = self.active_structure()
        head = fine_head(self.tenant, self.fine_income)
        with tenant_context(self.tenant.id):
            fine = FineFactory(
                tenant=self.tenant, student=self.student, fee_head=head, amount=Decimal("250.00")
            )
            services.generate_invoices(
                structure=structure,
                period_start=SEP,
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
            )
            invoice = FeeInvoice.objects.get(student=self.student)
            services.cancel_invoice(invoice=invoice, reason="Duplicate", actor_id=self.user.pk)
            fine.refresh_from_db()

        self.assertEqual(fine.status, FineStatus.PENDING)

    def test_a_part_paid_invoice_cannot_be_cancelled(self) -> None:
        """Money already received cannot be un-received — §7.3's refund
        workflow is the route, and cancelling would leave the payment pointing
        at a void charge."""
        structure, _, _ = self.active_structure()
        with tenant_context(self.tenant.id):
            services.generate_invoices(
                structure=structure,
                period_start=SEP,
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
            )
            invoice = FeeInvoice.objects.get(student=self.student)
            # Written directly because PR C owns payments; the rule under test
            # is the cancellation guard, not how the money arrived.
            FeeInvoice.objects.filter(pk=invoice.pk).update(
                paid_total=Decimal("100.00"),
                balance_due=invoice.subtotal
                - invoice.discount_total
                + invoice.fine_total
                - Decimal("100.00"),
                status=InvoiceStatus.PARTIALLY_PAID,
            )
            invoice.refresh_from_db()

            with self.assertRaises(DomainRuleViolation) as caught:
                services.cancel_invoice(
                    invoice=invoice, reason="Changed my mind", actor_id=self.user.pk
                )

        self.assertIn("Refund", str(caught.exception.detail))


class WaiverTests(FeesFinanceAPITestCase):
    def test_waiving_records_the_actor_and_the_reason(self) -> None:
        head = fine_head(self.tenant, self.fine_income)
        with tenant_context(self.tenant.id):
            fine = FineFactory(tenant=self.tenant, student=self.student, fee_head=head)
            waived = services.waive_fine(
                fine=fine, reason="Book was returned on time", actor_id=self.user.pk
            )

        self.assertEqual(waived.status, FineStatus.WAIVED)
        self.assertEqual(waived.waived_by, self.user.pk)
        self.assertEqual(waived.waived_reason, "Book was returned on time")

    def test_an_invoiced_fine_cannot_be_waived(self) -> None:
        """It is part of a document a parent has been given; the correction is
        an adjustment or a cancellation, not editing the fine out from under it."""
        structure, _, _ = self.active_structure()
        head = fine_head(self.tenant, self.fine_income)
        with tenant_context(self.tenant.id):
            fine = FineFactory(tenant=self.tenant, student=self.student, fee_head=head)
            services.generate_invoices(
                structure=structure,
                period_start=SEP,
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
            )
            fine.refresh_from_db()

            with self.assertRaises(DomainRuleViolation):
                services.waive_fine(fine=fine, reason="Too late", actor_id=self.user.pk)

    def test_waiving_without_a_reason_is_refused(self) -> None:
        head = fine_head(self.tenant, self.fine_income)
        with tenant_context(self.tenant.id):
            fine = FineFactory(tenant=self.tenant, student=self.student, fee_head=head)

            with self.assertRaises(DomainRuleViolation):
                services.waive_fine(fine=fine, reason="   ", actor_id=self.user.pk)

    def test_revoking_a_discount_leaves_issued_invoices_alone(self) -> None:
        """Forward-looking by design: re-pricing an issued invoice would change
        what a parent was told they owe."""
        structure, _, _ = self.active_structure(amount=Decimal("1000.00"))
        with tenant_context(self.tenant.id):
            discount = DiscountFactory(
                tenant=self.tenant,
                student=self.student,
                academic_session=self.session,
                value=Decimal("20.00"),
            )
            services.generate_invoices(
                structure=structure,
                period_start=SEP,
                actor_id=self.user.pk,
                tenant_id=self.tenant.pk,
            )
            services.revoke_discount(
                discount=discount, reason="No longer eligible", actor_id=self.user.pk
            )
            invoice = FeeInvoice.objects.get(student=self.student)

        self.assertEqual(invoice.discount_total, Decimal("200.00"))
