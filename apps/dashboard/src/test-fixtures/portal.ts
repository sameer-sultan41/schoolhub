import type {
  FeeInvoiceRecord,
  PortalChild,
  PortalDashboard,
  PortalModules,
  ReceiptRecord,
  ResultRecord,
} from "@/services";

/** The portal screens' fixtures: the shell's and every portal screen's tests read them. */

export const AYESHA_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const BILAL_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

export const ALL_MODULES_ON: PortalModules = {
  attendance: true,
  fees: true,
  examinations: true,
  communication: true,
  timetable: true,
};

export function portalChild(
  id: string,
  firstName: string,
  lastName: string,
  overrides: Partial<PortalChild> = {},
): PortalChild {
  return {
    student: {
      id,
      first_name: firstName,
      last_name: lastName,
      admission_number: "ADM-001",
      class_name: "Grade 5",
      section_name: "A",
    },
    attendance: {
      today: "present",
      month_percentage: "96.00",
      month_present_days: 12,
      month_counted_days: 13,
    },
    fees: { outstanding_total: "12000.00", outstanding_count: 1, next_due_date: "2026-11-30" },
    latest_result: {
      exam_name: "Mid-term",
      percentage: "81.50",
      grade: "A",
      published_at: "2026-10-20T09:00:00Z",
    },
    ...overrides,
  };
}

export function portalDashboard(overrides: Partial<PortalDashboard> = {}): PortalDashboard {
  return {
    as_of: "2026-11-15",
    children: [portalChild(AYESHA_ID, "Ayesha", "Khan"), portalChild(BILAL_ID, "Bilal", "Khan")],
    unread_notifications: 0,
    unread_threads: 0,
    modules: ALL_MODULES_ON,
    ...overrides,
  };
}

export const INVOICE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const PAID_INVOICE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const RECEIPT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

/** An issued invoice for Ayesha with one line; override what a test needs. */
export function portalInvoice(overrides: Partial<FeeInvoiceRecord> = {}): FeeInvoiceRecord {
  return {
    id: INVOICE_ID,
    invoice_no: "INV-0001",
    student: AYESHA_ID,
    student_name: "Ayesha Khan",
    student_enrollment: null,
    academic_session: "11111111-1111-4111-8111-111111111111",
    fee_structure: null,
    period_label: "Term 1",
    issue_date: "2026-10-01",
    due_date: "2026-11-30",
    status: "issued",
    subtotal: "12000.00",
    discount_total: "0.00",
    fine_total: "0.00",
    paid_total: "0.00",
    balance_due: "12000.00",
    canceled_reason: null,
    lines: [
      {
        id: "99999999-9999-4999-8999-999999999999",
        fee_head: "88888888-8888-4888-8888-888888888888",
        fee_head_code: "TUITION",
        description: "Tuition",
        amount: "12000.00",
        discount_amount: "0.00",
        net_amount: 12000,
        source_type: "schedule",
        source_id: null,
      },
    ],
    created_at: "2026-10-01T08:00:00Z",
    updated_at: "2026-10-01T08:00:00Z",
    ...overrides,
  };
}

export function portalReceipt(overrides: Partial<ReceiptRecord> = {}): ReceiptRecord {
  return {
    id: RECEIPT_ID,
    receipt_no: "RCP-0001",
    payment: "77777777-7777-4777-8777-777777777777",
    invoice_no: "INV-0002",
    student_name: "Ayesha Khan",
    amount: "9000.00",
    issued_at: "2026-10-15T09:00:00Z",
    pdf_file: null,
    ...overrides,
  };
}

/** A published result for Ayesha. */
export function portalResult(overrides: Partial<ResultRecord> = {}): ResultRecord {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    exam_id: "55555555-5555-4555-8555-555555555555",
    exam_name: "Mid-term",
    term_name: "Term 1",
    student_id: AYESHA_ID,
    section_id: "44444444-4444-4444-8444-444444444444",
    total_max_marks: "400.00",
    total_obtained_marks: "326.00",
    percentage: "81.50",
    grade: "A",
    gpa: null,
    rank_in_section: 3,
    rank_in_class: null,
    outcome: "pass",
    grace_marks: "0.00",
    status: "published",
    approved_at: "2026-10-19T09:00:00Z",
    published_at: "2026-10-20T09:00:00Z",
    created_at: "2026-10-19T08:00:00Z",
    updated_at: "2026-10-20T09:00:00Z",
    ...overrides,
  };
}
