"""§16's invoicing endpoints.

The cases worth reading twice are the portal ones. §3 gives a guardian a view of
their children's invoices, and every write on the same viewsets must stay
staff-only — the privilege-escalation shape PR #42 found, where a viewset-wide
portal exemption covered a bulk write too. So each portal-readable viewset is
tested from both sides: a guardian reads their own child and nobody else's, and
the same guardian is refused every write.
"""

from __future__ import annotations

from decimal import Decimal

from apps.fees_finance.models import (
    DiscountStatus,
    FeeInvoice,
    FineStatus,
    InvoiceStatus,
    ScholarshipStatus,
)
from apps.fees_finance.tests.base import FeesFinanceAPITestCase
from apps.fees_finance.tests.factories import (
    DiscountFactory,
    FeeHeadFactory,
    FeeInvoiceFactory,
    FineFactory,
    ScholarshipFactory,
    authenticate,
    fine_head,
    grant,
)
from core.tenancy.context import tenant_context


class GenerateEndpointTests(FeesFinanceAPITestCase):
    def test_generation_returns_202_and_a_job(self) -> None:
        """§7.1 makes generation a background job: a term's billing for a
        2000-student school is not work an accountant watches a spinner for."""
        structure, _, _ = self.active_structure()

        response = self.client.post(
            "/api/v1/fee-invoices:generate",
            {"fee_structure": str(structure.pk), "period_start": "2026-09-01"},
            format="json",
        )

        self.assertEqual(response.status_code, 202)
        self.assertIn("job_id", response.json()["data"])

    def test_naming_both_a_month_and_a_term_is_refused(self) -> None:
        """A per-term run takes its whole window from the term, so accepting
        both would leave `period_start` silently ignored — and a caller who
        passed the wrong month would get correct-looking invoices for a period
        they did not ask for."""
        structure, _, _ = self.active_structure()

        response = self.client.post(
            "/api/v1/fee-invoices:generate",
            {
                "fee_structure": str(structure.pk),
                "period_start": "2026-09-01",
                "term": str(self.term.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_naming_neither_is_refused(self) -> None:
        structure, _, _ = self.active_structure()

        response = self.client.post(
            "/api/v1/fee-invoices:generate",
            {"fee_structure": str(structure.pk)},
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_a_draft_structure_is_refused_before_the_job_is_queued(self) -> None:
        """Checked in the view as well as the task, so a caller learns now
        rather than by polling a job that was always going to fail."""
        from apps.fees_finance.models import FeeStructureStatus
        from apps.fees_finance.tests.factories import FeeStructureFactory

        with tenant_context(self.tenant.id):
            draft = FeeStructureFactory(
                tenant=self.tenant,
                academic_session=self.session,
                status=FeeStructureStatus.DRAFT,
            )

        response = self.client.post(
            "/api/v1/fee-invoices:generate",
            {"fee_structure": str(draft.pk), "period_start": "2026-09-01"},
            format="json",
        )

        self.assertEqual(response.status_code, 422)

    def test_a_repeat_submission_with_the_same_idempotency_key_replays(self) -> None:
        """§11's closing line: money mutations require an Idempotency-Key. The
        key stops a double *submit*; the duplicate index stops a double *bill*,
        so the two layers cover different failures."""
        structure, _, _ = self.active_structure()
        payload = {"fee_structure": str(structure.pk), "period_start": "2026-09-01"}

        first = self.client.post(
            "/api/v1/fee-invoices:generate",
            payload,
            format="json",
            HTTP_IDEMPOTENCY_KEY="run-one",
        )
        second = self.client.post(
            "/api/v1/fee-invoices:generate",
            payload,
            format="json",
            HTTP_IDEMPOTENCY_KEY="run-one",
        )

        self.assertEqual(first.status_code, 202)
        self.assertEqual(second.status_code, 202)
        self.assertEqual(first.json()["data"]["job_id"], second.json()["data"]["job_id"])


class InvoiceEndpointTests(FeesFinanceAPITestCase):
    def _invoice(self, **kwargs) -> FeeInvoice:
        with tenant_context(self.tenant.id):
            return FeeInvoiceFactory(
                tenant=self.tenant,
                student=kwargs.pop("student", self.student),
                academic_session=self.session,
                **kwargs,
            )

    def test_an_invoice_lists_with_its_derived_net_line_amounts(self) -> None:
        invoice = self._invoice()

        response = self.client.get(f"/api/v1/fee-invoices/{invoice.pk}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["balance_due"], "1000.00")

    def test_money_columns_cannot_be_patched(self) -> None:
        """A PATCH that could move `paid_total` would let a client mark a bill
        paid with no payment behind it."""
        invoice = self._invoice()

        response = self.client.patch(
            f"/api/v1/fee-invoices/{invoice.pk}",
            {"paid_total": "1000.00", "balance_due": "0.00"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["paid_total"], "0.00")
        self.assertEqual(response.json()["data"]["balance_due"], "1000.00")

    def test_cancelling_requires_a_reason(self) -> None:
        invoice = self._invoice()

        response = self.client.post(f"/api/v1/fee-invoices/{invoice.pk}:cancel", {}, format="json")

        self.assertEqual(response.status_code, 400)

    def test_cancelling_records_the_reason(self) -> None:
        invoice = self._invoice()

        response = self.client.post(
            f"/api/v1/fee-invoices/{invoice.pk}:cancel",
            {"reason": "Billed against the wrong structure"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["status"], InvoiceStatus.CANCELED)
        self.assertEqual(
            response.json()["data"]["canceled_reason"],
            "Billed against the wrong structure",
        )

    def test_the_outstanding_filter_answers_the_defaulter_list(self) -> None:
        """§13's defaulter list in one query. `status` alone cannot express it:
        a partially-paid invoice owes a balance while an overdue one with a zero
        balance does not."""
        self._invoice()
        paid = self._invoice(
            student=self.students[1],
            paid_total=Decimal("1000.00"),
            status=InvoiceStatus.PAID,
        )

        response = self.client.get("/api/v1/fee-invoices?outstanding=true")

        self.assertEqual(response.status_code, 200)
        ids = {row["id"] for row in response.json()["data"]}
        self.assertNotIn(str(paid.pk), ids)
        self.assertEqual(len(ids), 1)


class PortalAccessTests(FeesFinanceAPITestCase):
    """A guardian reads their own child's money and writes nothing."""

    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.mine = FeeInvoiceFactory(
                tenant=self.tenant,
                student=self.student,
                academic_session=self.session,
                period_label="2026-09",
            )
            self.theirs = FeeInvoiceFactory(
                tenant=self.tenant,
                student=self.students[1],
                academic_session=self.session,
                period_label="2026-09",
            )
        grant(
            self.guardian_user,
            "fees.invoice.view",
            "fees.discount.view",
            "fees.fine.view",
            scope="own",
            is_restricted_principal=True,
        )
        authenticate(self.client, self.guardian_user)

    def test_a_guardian_sees_their_own_child_s_invoice_only(self) -> None:
        response = self.client.get("/api/v1/fee-invoices")

        self.assertEqual(response.status_code, 200)
        ids = {row["id"] for row in response.json()["data"]}
        self.assertEqual(ids, {str(self.mine.pk)})

    def test_another_family_s_invoice_is_404_never_403(self) -> None:
        """AGENTS.md invariant 2's reading applied to record scope: a 403 would
        confirm the invoice exists."""
        response = self.client.get(f"/api/v1/fee-invoices/{self.theirs.pk}")

        self.assertEqual(response.status_code, 404)

    def test_a_draft_invoice_is_hidden_from_a_restricted_principal(self) -> None:
        """A draft is a working document the accountant has not handed over.
        Showing a parent a charge that may still change is worse than showing
        them nothing."""
        with tenant_context(self.tenant.id):
            # A distinct `period_label`: this student already has an invoice
            # from setUp with both `fee_structure` and `period_label` null, and
            # NULLS NOT DISTINCT means a second such row is a genuine duplicate
            # — the guard refusing it here is the guard working.
            FeeInvoiceFactory(
                tenant=self.tenant,
                student=self.student,
                academic_session=self.session,
                status=InvoiceStatus.DRAFT,
                invoice_no="INV-DRAFT-1",
                period_label="2026-10",
            )

        response = self.client.get("/api/v1/fee-invoices")

        statuses = {row["status"] for row in response.json()["data"]}
        self.assertNotIn(InvoiceStatus.DRAFT, statuses)

    def test_a_guardian_cannot_trigger_a_billing_run(self) -> None:
        """The write half of the portal exemption. `get_permissions` resolves
        per action precisely so this stays 403 — DRF resolves
        `permission_classes` per view, not per action."""
        structure, _, _ = self.active_structure()

        response = self.client.post(
            "/api/v1/fee-invoices:generate",
            {"fee_structure": str(structure.pk), "period_start": "2026-09-01"},
            format="json",
        )

        self.assertEqual(response.status_code, 403)

    def test_a_guardian_cannot_cancel_an_invoice(self) -> None:
        response = self.client.post(
            f"/api/v1/fee-invoices/{self.mine.pk}:cancel",
            {"reason": "I would rather not pay"},
            format="json",
        )

        self.assertEqual(response.status_code, 403)

    def test_a_guardian_cannot_grant_themselves_a_discount(self) -> None:
        response = self.client.post(
            "/api/v1/discounts",
            {
                "student": str(self.student.pk),
                "academic_session": str(self.session.pk),
                "name": "Self-service discount",
                "discount_type": "percent",
                "value": "100.00",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)

    def test_a_guardian_cannot_waive_a_fine(self) -> None:
        head = fine_head(self.tenant, self.fine_income)
        with tenant_context(self.tenant.id):
            fine = FineFactory(tenant=self.tenant, student=self.student, fee_head=head)

        response = self.client.post(
            f"/api/v1/fines/{fine.pk}:waive", {"reason": "No thanks"}, format="json"
        )

        self.assertEqual(response.status_code, 403)

    def test_a_guardian_sees_the_discount_that_explains_their_bill(self) -> None:
        """The reason `fees.discount.view` was registered at all: a parent shown
        a reduced bill has to be able to check the reduction."""
        with tenant_context(self.tenant.id):
            DiscountFactory(
                tenant=self.tenant,
                student=self.student,
                academic_session=self.session,
                value=Decimal("15.00"),
            )

        response = self.client.get("/api/v1/discounts")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["data"]), 1)


class GrantEndpointTests(FeesFinanceAPITestCase):
    def test_a_discount_stamps_its_granter_from_the_request(self) -> None:
        """`discounts_active_is_attributable` refuses an active grant with no
        approver, and taking the value from the request is what makes that
        attribution mean something — a client-supplied `approved_by` would let a
        reduction name someone who never saw it."""
        response = self.client.post(
            "/api/v1/discounts",
            {
                "student": str(self.student.pk),
                "academic_session": str(self.session.pk),
                "name": "Sibling discount",
                "discount_type": "percent",
                "value": "10.00",
                "approved_by": "00000000-0000-0000-0000-000000000000",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["data"]["approved_by"], str(self.user.pk))

    def test_a_percent_discount_over_a_hundred_is_refused(self) -> None:
        response = self.client.post(
            "/api/v1/discounts",
            {
                "student": str(self.student.pk),
                "academic_session": str(self.session.pk),
                "name": "Too generous",
                "discount_type": "percent",
                "value": "150.00",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_revoking_a_discount_requires_a_reason(self) -> None:
        with tenant_context(self.tenant.id):
            discount = DiscountFactory(
                tenant=self.tenant, student=self.student, academic_session=self.session
            )

        response = self.client.post(f"/api/v1/discounts/{discount.pk}:revoke", {}, format="json")

        self.assertEqual(response.status_code, 400)

    def test_revoking_records_the_reason_and_the_status(self) -> None:
        with tenant_context(self.tenant.id):
            discount = DiscountFactory(
                tenant=self.tenant, student=self.student, academic_session=self.session
            )

        response = self.client.post(
            f"/api/v1/discounts/{discount.pk}:revoke",
            {"reason": "Sibling has left the school"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["status"], DiscountStatus.REVOKED)

    def test_an_applied_scholarship_carries_no_approver(self) -> None:
        """`applied` is the one status with no approver, because that is what
        "applied" means: the school has not decided yet."""
        response = self.client.post(
            "/api/v1/scholarships",
            {
                "student": str(self.student.pk),
                "academic_session": str(self.session.pk),
                "name": "Merit award",
                "coverage_type": "percent",
                "value": "50.00",
                "status": ScholarshipStatus.APPLIED,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertIsNone(response.json()["data"]["approved_by"])

    def test_deciding_an_applied_scholarship_stamps_the_approver(self) -> None:
        with tenant_context(self.tenant.id):
            scholarship = ScholarshipFactory(
                tenant=self.tenant,
                student=self.student,
                academic_session=self.session,
                status=ScholarshipStatus.APPLIED,
                approved_by=None,
            )

        response = self.client.patch(
            f"/api/v1/scholarships/{scholarship.pk}",
            {"status": ScholarshipStatus.APPROVED},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["approved_by"], str(self.user.pk))


class FineEndpointTests(FeesFinanceAPITestCase):
    def test_a_fine_must_use_a_fee_head_in_the_fine_category(self) -> None:
        """§15's rule, enforced in the serializer because `category` lives on
        the other table. It is what keeps penalties out of the tuition line of a
        school's income statement."""
        with tenant_context(self.tenant.id):
            tuition = FeeHeadFactory(tenant=self.tenant, ledger_account=self.fee_income)

        response = self.client.post(
            "/api/v1/fines",
            {
                "student": str(self.student.pk),
                "fee_head": str(tuition.pk),
                "fine_type": "library",
                "amount": "250.00",
                "reason": "Overdue book",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_a_fine_on_a_fine_head_is_created(self) -> None:
        head = fine_head(self.tenant, self.fine_income)

        response = self.client.post(
            "/api/v1/fines",
            {
                "student": str(self.student.pk),
                "fee_head": str(head.pk),
                "fine_type": "library",
                "amount": "250.00",
                "reason": "Overdue book",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["data"]["status"], FineStatus.PENDING)

    def test_waiving_records_the_actor_and_reason(self) -> None:
        head = fine_head(self.tenant, self.fine_income)
        with tenant_context(self.tenant.id):
            fine = FineFactory(tenant=self.tenant, student=self.student, fee_head=head)

        response = self.client.post(
            f"/api/v1/fines/{fine.pk}:waive",
            {"reason": "Returned same day"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["status"], FineStatus.WAIVED)
        self.assertEqual(response.json()["data"]["waived_by"], str(self.user.pk))
