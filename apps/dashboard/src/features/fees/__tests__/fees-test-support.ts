import { ApiError } from "@schoolhub/api-client";
import type { PermissionKey } from "@schoolhub/types";
import type { Page } from "@schoolhub/types";

import { Services } from "@/services";
import type {
  FeeHeadRecord,
  FeeInvoiceRecord,
  FeeScheduleRecord,
  FeeStructureRecord,
  LedgerAccountRecord,
  PaymentRecord,
  VoucherRecord,
} from "@/services";
import { mocked } from "@/test-fixtures/list-screen";
import { buildUser, setUrl } from "@/test-utils";

/** Shared setup for the fees-setup tests; each file keeps its own `jest.mock` calls. */

export { mocked, rowOf, urlParam } from "@/test-fixtures/list-screen";

export const listLedgerAccounts = mocked(Services.ledgerAccounts.listLedgerAccounts);
export const fetchLedgerAccountOptions = mocked(Services.ledgerAccounts.fetchLedgerAccountOptions);
export const createLedgerAccount = mocked(Services.ledgerAccounts.createLedgerAccount);
export const updateLedgerAccount = mocked(Services.ledgerAccounts.updateLedgerAccount);
export const deleteLedgerAccount = mocked(Services.ledgerAccounts.deleteLedgerAccount);
export const listFeeHeads = mocked(Services.feeHeads.listFeeHeads);
export const fetchFeeHeadOptions = mocked(Services.feeHeads.fetchFeeHeadOptions);
export const createFeeHead = mocked(Services.feeHeads.createFeeHead);
export const updateFeeHead = mocked(Services.feeHeads.updateFeeHead);
export const deleteFeeHead = mocked(Services.feeHeads.deleteFeeHead);
export const listFeeStructures = mocked(Services.feeStructures.listFeeStructures);
export const fetchFeeStructure = mocked(Services.feeStructures.fetchFeeStructure);
export const createFeeStructure = mocked(Services.feeStructures.createFeeStructure);
export const fetchFeeStructureOptions = mocked(Services.feeStructures.fetchFeeStructureOptions);
export const listFeeInvoices = mocked(Services.feeInvoices.listFeeInvoices);
export const fetchFeeInvoice = mocked(Services.feeInvoices.fetchFeeInvoice);
export const generateFeeInvoices = mocked(Services.feeInvoices.generateFeeInvoices);
export const cancelFeeInvoice = mocked(Services.feeInvoices.cancelFeeInvoice);
export const listPayments = mocked(Services.payments.listPayments);
export const recordPayment = mocked(Services.payments.recordPayment);
export const downloadReceipt = mocked(Services.receipts.downloadReceipt);
export const listVouchers = mocked(Services.vouchers.listVouchers);
export const fetchJob = mocked(Services.jobs.fetchJob);
export const activateFeeStructure = mocked(Services.feeStructures.activateFeeStructure);
export const archiveFeeStructure = mocked(Services.feeStructures.archiveFeeStructure);
export const createFeeSchedule = mocked(Services.feeSchedules.createFeeSchedule);
export const deleteFeeSchedule = mocked(Services.feeSchedules.deleteFeeSchedule);
export const fetchAcademicSessions = mocked(Services.schoolOrganization.fetchAcademicSessions);
export const fetchClasses = mocked(Services.schoolOrganization.fetchClasses);
export const fetchTerms = mocked(Services.schoolOrganization.fetchTerms);
export const fetchCampuses = mocked(Services.dashboard.fetchCampuses);

export const SESSION_ID = "11111111-1111-4111-8111-111111111111";
export const CLASS_ID = "22222222-2222-4222-8222-222222222222";
export const CAMPUS_ID = "33333333-3333-4333-8333-333333333333";
export const TERM_ID = "44444444-4444-4444-8444-444444444444";
export const INCOME_ACCOUNT_ID = "55555555-5555-4555-8555-555555555555";
export const ASSET_ACCOUNT_ID = "66666666-6666-4666-8666-666666666666";
export const HEAD_ID = "77777777-7777-4777-8777-777777777777";
export const STRUCTURE_ID = "88888888-8888-4888-8888-888888888888";
export const INVOICE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const STUDENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const SCHEDULE_ID = "99999999-9999-4999-8999-999999999999";
const STAMP = "2026-10-01T00:00:00Z";

/** The setup keys the seeded `accountant` holds (permissions.py: structure authors, the ledger
 * viewer and writer), plus the reference reads the pickers make. Not the role's whole set. */
export const FEES_SETUP_AUTHOR_PERMISSIONS: PermissionKey[] = [
  "fees.fee-structure.view",
  "fees.fee-structure.create",
  "fees.fee-structure.update",
  "fees.fee-structure.delete",
  "fees.ledger.view",
  "fees.ledger.create",
  "school.academic-session.view",
  "school.class.view",
  "school.campus.view",
];

/** The keys the seeded `accountant` holds for invoicing, plus the reference reads its pickers make. */
export const INVOICING_PERMISSIONS: PermissionKey[] = [
  "fees.invoice.view",
  "fees.invoice.create",
  "fees.invoice.update",
  "fees.payment.view",
  "fees.fee-structure.view",
  "school.academic-session.view",
];

/** The keys the seeded `finance_staff` holds for the counter (`fees.payment.collect`, the invoice
 * read), plus the student read its picker makes. */
export const COUNTER_PERMISSIONS: PermissionKey[] = [
  "fees.payment.collect",
  "fees.invoice.view",
  "students.student.view",
];

export function cursorPage<T>(items: T[], nextCursor: string | null = null): Page<T> {
  return { items, pagination: { page_size: 25, next_cursor: nextCursor, previous_cursor: null } };
}

export function accountRecord(overrides: Partial<LedgerAccountRecord> = {}): LedgerAccountRecord {
  return {
    id: INCOME_ACCOUNT_ID,
    code: "4001",
    name: "Tuition income",
    account_type: "income",
    parent: null,
    is_active: true,
    is_system: false,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

export function headRecord(overrides: Partial<FeeHeadRecord> = {}): FeeHeadRecord {
  return {
    id: HEAD_ID,
    name: "Library fee",
    code: "LIB",
    category: "library",
    ledger_account: INCOME_ACCOUNT_ID,
    is_refundable: false,
    is_active: true,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

export function scheduleRecord(overrides: Partial<FeeScheduleRecord> = {}): FeeScheduleRecord {
  return {
    id: SCHEDULE_ID,
    fee_structure: STRUCTURE_ID,
    fee_head: HEAD_ID,
    amount: "1500.00",
    frequency: "monthly",
    term: null,
    due_day: 10,
    due_date: null,
    late_fee_policy: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

export function structureRecord(overrides: Partial<FeeStructureRecord> = {}): FeeStructureRecord {
  return {
    id: STRUCTURE_ID,
    name: "Grade 1 fees",
    academic_session: SESSION_ID,
    school_class: CLASS_ID,
    campus: null,
    status: "draft",
    schedules: [],
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

/** The server's refusal naming `field`: a 422 `domain_rule_violation` (`DomainRuleViolation`), or
 * with `status` 400 a serializer's `validation_error`. `message` is the issue text, as the
 * envelope handler sets it for a single detail (core/api/exceptions.py). */
export function ruleViolation(field: string, issue: string, status = 422) {
  return new ApiError({
    status,
    code: status === 422 ? "domain_rule_violation" : "validation_error",
    message: issue,
    url: "/fees",
    details: [{ field, issue }],
  });
}

/** Signs in with exactly `keys`. */
export function asUser(...keys: PermissionKey[]) {
  mocked(Services.auth.fetchCurrentUser).mockResolvedValue(buildUser(keys));
}

/** The `beforeEach` of every fees-setup test: no keys, one of each record, and the reference lists. */
export function stubFeesServices(url = "/fees/structures") {
  jest.clearAllMocks();
  setUrl(url);
  asUser();
  listLedgerAccounts.mockResolvedValue(cursorPage([accountRecord()]));
  listFeeHeads.mockResolvedValue(cursorPage([headRecord()]));
  fetchLedgerAccountOptions.mockResolvedValue([accountRecord()]);
  fetchFeeHeadOptions.mockResolvedValue([headRecord()]);
  listFeeStructures.mockResolvedValue(cursorPage([structureRecord()]));
  fetchFeeStructure.mockResolvedValue(structureRecord());
  fetchAcademicSessions.mockResolvedValue([
    { id: SESSION_ID, name: "2026-27", is_current: true, status: "active" },
  ] as Awaited<ReturnType<typeof fetchAcademicSessions>>);
  fetchClasses.mockResolvedValue([{ id: CLASS_ID, name: "Grade 1" }]);
  fetchCampuses.mockResolvedValue([{ id: CAMPUS_ID, name: "North campus" }] as Awaited<
    ReturnType<typeof fetchCampuses>
  >);
  fetchTerms.mockResolvedValue([{ id: TERM_ID, name: "Term 1", sequence: 1 }]);
  fetchFeeStructureOptions.mockResolvedValue([structureRecord({ status: "active" })]);
  listFeeInvoices.mockResolvedValue(cursorPage([invoiceRecord()]));
  fetchFeeInvoice.mockResolvedValue(invoiceRecord());
  listPayments.mockResolvedValue(cursorPage([]));
  listVouchers.mockResolvedValue(cursorPage([]));
}

/** An issued, unpaid invoice with one fee line and one fine line. Every money field is the
 * server's own string, so a test asserts what the screen renders against these. */
export function invoiceRecord(overrides: Partial<FeeInvoiceRecord> = {}): FeeInvoiceRecord {
  return {
    id: INVOICE_ID,
    invoice_no: "INV-2026-0001",
    student: STUDENT_ID,
    student_name: "Ayesha Khan",
    student_enrollment: null,
    academic_session: SESSION_ID,
    fee_structure: STRUCTURE_ID,
    period_label: "2026-10",
    issue_date: "2026-10-01",
    due_date: "2026-10-10",
    status: "issued",
    subtotal: "1500.00",
    discount_total: "200.00",
    fine_total: "50.00",
    paid_total: "0.00",
    balance_due: "1350.00",
    canceled_reason: null,
    lines: [
      {
        id: "l1111111-1111-4111-8111-111111111111",
        fee_head: HEAD_ID,
        fee_head_code: "TUI",
        description: "Tuition fee",
        amount: "1500.00",
        discount_amount: "200.00",
        net_amount: 1300,
        source_type: "schedule",
        source_id: SCHEDULE_ID,
      },
      {
        id: "l2222222-2222-4222-8222-222222222222",
        fee_head: HEAD_ID,
        fee_head_code: "LIB",
        description: "Library fine",
        amount: "50.00",
        discount_amount: "0.00",
        net_amount: 50,
        source_type: "fine",
        source_id: null,
      },
    ],
    created_at: STAMP,
    updated_at: STAMP,
    ...overrides,
  };
}

export function paymentRecord(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: "d1111111-1111-4111-8111-111111111111",
    fee_invoice: INVOICE_ID,
    student: STUDENT_ID,
    amount: "500.00",
    method: "cash",
    reference_no: null,
    gateway_provider: null,
    status: "confirmed",
    paid_at: "2026-10-05T09:00:00Z",
    received_by: null,
    receipt: "b1111111-1111-4111-8111-111111111111",
    receipt_no: "RCT-2026-0001",
    created_at: STAMP,
    ...overrides,
  };
}

export function voucherRecord(overrides: Partial<VoucherRecord> = {}): VoucherRecord {
  return {
    id: "e1111111-1111-4111-8111-111111111111",
    fee_invoice: INVOICE_ID,
    invoice_no: "INV-2026-0001",
    student: STUDENT_ID,
    student_name: "Ayesha Khan",
    provider: "bank_branch",
    consumer_number: "1234567890",
    amount: "1350.00",
    due_date: "2026-10-10",
    status: "issued",
    payment: null,
    voided_reason: null,
    issued_by: "f1111111-1111-4111-8111-111111111111",
    created_at: STAMP,
    ...overrides,
  };
}
