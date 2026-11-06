import type { ApiSchemas } from "@schoolhub/api-client";

/**
 * The server's state behind `portalModule` (`./portal`): what a guardian's portal reads and the
 * few things it writes (an inbox row's read state, a notice's acknowledgment, a notification
 * preference). Every shape is the generated one (`ApiSchemas`), so a contract change breaks the
 * suite at compile time (L5). The stub serves what it is seeded with: which rows a guardian may
 * see (drafts, unpublished results, another family's children) is the Django suite's job, so a
 * seed here is already what the server would have let through.
 */

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export type PortalDashboard = ApiSchemas["PortalDashboard"];
export type PortalChild = ApiSchemas["PortalChild"];
export type PortalStudent = ApiSchemas["PortalStudent"];
export type PortalModules = ApiSchemas["PortalModules"];
export type PortalAttendanceRow = ApiSchemas["StudentAttendance"];
export type PortalInvoice = ApiSchemas["FeeInvoice"];
export type PortalReceipt = ApiSchemas["Receipt"];
export type PortalResult = ApiSchemas["Result"];
export type PortalAdmitCard = ApiSchemas["AdmitCard"];
export type PortalVoucher = ApiSchemas["FeeVoucher"];
export type PortalLeaveType = ApiSchemas["LeaveType"];
export type PortalLeaveRequest = Mutable<ApiSchemas["LeaveRequest"]>;
export type PortalNotice = Mutable<ApiSchemas["PortalNotice"]>;
export type PortalNotification = Mutable<ApiSchemas["Notification"]>;
export type PreferenceRow = Mutable<ApiSchemas["NotificationPreferenceRow"]>;

/** Stable ids the specs name directly (UUID-shaped, like the real ones). */
export const PORTAL_IDS = {
  ayesha: "00000000-0000-4000-b000-000000000001",
  bilal: "00000000-0000-4000-b000-000000000002",
  session: "00000000-0000-4000-b000-000000000011",
  teacher: "00000000-0000-4000-b000-000000000013",
  section: "00000000-0000-4000-b000-000000000012",
  openInvoice: "00000000-0000-4000-b000-000000000021",
  paidInvoice: "00000000-0000-4000-b000-000000000022",
  bilalInvoice: "00000000-0000-4000-b000-000000000023",
  receipt: "00000000-0000-4000-b000-000000000031",
  voucher: "00000000-0000-4000-b000-000000000033",
  sickLeave: "00000000-0000-4000-b000-000000000071",
  casualLeave: "00000000-0000-4000-b000-000000000072",
  staffLeave: "00000000-0000-4000-b000-000000000073",
  leaveRequest: "00000000-0000-4000-b000-000000000074",
  payment: "00000000-0000-4000-b000-000000000032",
  midTerm: "00000000-0000-4000-b000-000000000041",
  annual: "00000000-0000-4000-b000-000000000042",
  bilalResult: "00000000-0000-4000-b000-000000000043",
  finals: "00000000-0000-4000-b000-000000000044",
  admitCard: "00000000-0000-4000-b000-000000000045",
  bilalAdmitCard: "00000000-0000-4000-b000-000000000046",
  notice: "00000000-0000-4000-b000-000000000051",
  feesNotification: "00000000-0000-4000-b000-000000000061",
  attendanceNotification: "00000000-0000-4000-b000-000000000062",
} as const;

export const PORTAL_AS_OF = "2026-11-15";

export const ALL_PORTAL_MODULES_ON: PortalModules = {
  attendance: true,
  fees: true,
  examinations: true,
  communication: true,
  timetable: true,
};

/** `NotificationCategoryEnum` and `NotificationChannelEnum`, in the matrix's own order. */
const CATEGORIES: ApiSchemas["NotificationCategoryEnum"][] = [
  "attendance",
  "fees",
  "exams",
  "library",
  "transport",
  "academic",
  "general",
  "emergency",
];
const CHANNELS: ApiSchemas["NotificationChannelEnum"][] = [
  "in_app",
  "email",
  "sms",
  "push",
  "whatsapp",
];

export function buildPortalChild(
  student: Pick<PortalStudent, "id" | "first_name" | "last_name"> & Partial<PortalStudent>,
  cards: Partial<Omit<PortalChild, "student">> = {},
): PortalChild {
  return {
    student: { admission_number: "ADM-001", class_name: "Grade 5", section_name: "A", ...student },
    attendance: {
      today: "present",
      month_percentage: "96.0",
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
    ...cards,
  };
}

export const AYESHA = buildPortalChild({
  id: PORTAL_IDS.ayesha,
  first_name: "Ayesha",
  last_name: "Khan",
});
export const BILAL = buildPortalChild(
  { id: PORTAL_IDS.bilal, first_name: "Bilal", last_name: "Khan", admission_number: "ADM-002" },
  {
    attendance: {
      today: null,
      month_percentage: null,
      month_present_days: 0,
      month_counted_days: 0,
    },
  },
);

export function buildAttendanceRow(
  studentId: string,
  attendanceDate: string,
  status: PortalAttendanceRow["status"],
): PortalAttendanceRow {
  return {
    id: `attendance-${studentId.slice(-2)}-${attendanceDate}`,
    student_id: studentId,
    student_name: "Ayesha Khan",
    admission_number: "ADM-001",
    section_id: PORTAL_IDS.section,
    section_name: "A",
    academic_session_id: PORTAL_IDS.session,
    period_id: null,
    period_name: null,
    attendance_date: attendanceDate,
    status,
    check_in_time: null,
    check_out_time: null,
    late_minutes: null,
    leave_request_id: null,
    source: "manual",
    marked_by: PORTAL_IDS.teacher,
    is_locked: false,
    remarks: null,
    created_at: `${attendanceDate}T08:00:00Z`,
    updated_at: `${attendanceDate}T08:00:00Z`,
  };
}

export function buildInvoice(overrides: Partial<PortalInvoice> = {}): PortalInvoice {
  return {
    id: PORTAL_IDS.openInvoice,
    invoice_no: "INV-0001",
    student: PORTAL_IDS.ayesha,
    student_name: "Ayesha Khan",
    student_enrollment: null,
    academic_session: PORTAL_IDS.session,
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
    lines: [],
    created_at: "2026-10-01T08:00:00Z",
    updated_at: "2026-10-01T08:00:00Z",
    ...overrides,
  };
}

export function buildReceipt(overrides: Partial<PortalReceipt> = {}): PortalReceipt {
  return {
    id: PORTAL_IDS.receipt,
    receipt_no: "RCP-0001",
    payment: PORTAL_IDS.payment,
    invoice_no: "INV-0002",
    student_name: "Ayesha Khan",
    amount: "9000.00",
    issued_at: "2026-10-15T09:00:00Z",
    pdf_file: null,
    ...overrides,
  };
}

export function buildResult(overrides: Partial<PortalResult> = {}): PortalResult {
  return {
    id: PORTAL_IDS.midTerm,
    exam_id: PORTAL_IDS.midTerm,
    exam_name: "Mid-term",
    term_name: "Term 1",
    student_id: PORTAL_IDS.ayesha,
    student_name: "Ayesha Khan",
    admission_number: "ADM-001",
    section_id: PORTAL_IDS.section,
    section_name: "A",
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
    processed_by: null,
    processed_by_name: null,
    approved_by: null,
    approved_by_name: null,
    approved_at: "2026-10-19T09:00:00Z",
    published_at: "2026-10-20T09:00:00Z",
    created_at: "2026-10-19T08:00:00Z",
    updated_at: "2026-10-20T09:00:00Z",
    ...overrides,
  };
}

/** Ayesha's issued admit card for an exam not yet over. */
export function buildPortalAdmitCard(overrides: Partial<PortalAdmitCard> = {}): PortalAdmitCard {
  return {
    id: PORTAL_IDS.admitCard,
    exam_id: PORTAL_IDS.finals,
    exam_name: "Finals",
    exam_starts_on: "2026-12-01",
    exam_ends_on: "2026-12-10",
    student_id: PORTAL_IDS.ayesha,
    student_name: "Ayesha Khan",
    admission_number: "ADM-001",
    section_id: PORTAL_IDS.section,
    section_name: "A",
    admit_card_no: "FIN-ADM-001",
    file_id: PORTAL_IDS.admitCard,
    status: "issued",
    issued_at: "2026-11-10T09:00:00Z",
    revoked_reason: null,
    created_at: "2026-11-10T08:59:00Z",
    updated_at: "2026-11-10T09:00:00Z",
    ...overrides,
  };
}

/** An issued bank slip for the open invoice. */
export function buildVoucher(overrides: Partial<PortalVoucher> = {}): PortalVoucher {
  return {
    id: PORTAL_IDS.voucher,
    fee_invoice: PORTAL_IDS.openInvoice,
    invoice_no: "INV-0001",
    student: PORTAL_IDS.ayesha,
    student_name: "Ayesha Khan",
    provider: "bank_branch",
    consumer_number: "1234567890",
    amount: "12000.00",
    due_date: "2026-11-30",
    status: "issued",
    payment: null,
    voided_reason: null,
    issued_by: PORTAL_IDS.teacher,
    created_at: "2026-10-02T08:00:00Z",
    ...overrides,
  };
}

export function buildPortalLeaveType(overrides: Partial<PortalLeaveType> = {}): PortalLeaveType {
  return {
    id: PORTAL_IDS.sickLeave,
    name: "Sick leave",
    code: "SICK",
    applies_to: "both",
    is_paid: true,
    requires_attachment: true,
    max_consecutive_days: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** The two types a student may use (one needing a document) and one that is staff only. */
export function buildPortalLeaveTypes(): PortalLeaveType[] {
  return [
    buildPortalLeaveType(),
    buildPortalLeaveType({
      id: PORTAL_IDS.casualLeave,
      name: "Family event",
      code: "CASUAL",
      requires_attachment: false,
    }),
    buildPortalLeaveType({
      id: PORTAL_IDS.staffLeave,
      name: "Staff only",
      code: "STAFF",
      applies_to: "staff",
    }),
  ];
}

export function buildPortalLeaveRequest(
  overrides: Partial<PortalLeaveRequest> = {},
): PortalLeaveRequest {
  return {
    id: PORTAL_IDS.leaveRequest,
    requester_type: "student",
    student_id: PORTAL_IDS.ayesha,
    student_name: "Ayesha Khan",
    admission_number: "ADM-001",
    section_name: "A",
    submitted_by: PORTAL_IDS.teacher,
    submitted_by_name: "Sana Khan",
    leave_type_id: PORTAL_IDS.casualLeave,
    leave_type_name: "Family event",
    start_date: "2026-11-20",
    end_date: "2026-11-20",
    day_part: "full",
    days_count: "1.0",
    reason: "A cousin's wedding",
    attachment_file_id: null,
    status: "pending",
    current_approval_level: 1,
    decided_at: null,
    approvals: [],
    created_at: "2026-11-10T08:00:00Z",
    updated_at: "2026-11-10T08:00:00Z",
    ...overrides,
  };
}

/** A published notice that asks for an acknowledgment nobody has given yet. */
export function buildNotice(overrides: Partial<PortalNotice> = {}): PortalNotice {
  return {
    id: PORTAL_IDS.notice,
    notice_no: "N-0001",
    title: "Sports day",
    body: "Sports day is on Friday.",
    notice_type: "event",
    published_at: "2026-11-02T08:00:00Z",
    requires_acknowledgment: true,
    acknowledged_at: null,
    ...overrides,
  };
}

/** An unread, normal-priority fees notification. */
export function buildNotification(overrides: Partial<PortalNotification> = {}): PortalNotification {
  return {
    id: PORTAL_IDS.feesNotification,
    event_key: "fees.invoice_issued",
    category: "fees",
    title: "Invoice issued",
    body: "Invoice INV-0001 is due on 30 November.",
    data: null,
    source_type: null,
    source_id: null,
    priority: "normal",
    read_at: null,
    created_at: "2026-11-03T09:00:00Z",
    ...overrides,
  };
}

/** The full category x channel matrix, everything on (a pair with no row is on, too). */
export function buildPreferenceMatrix(): PreferenceRow[] {
  return CATEGORIES.flatMap((event_category) =>
    CHANNELS.map((channel) => ({ event_category, channel, is_enabled: true })),
  );
}

export interface PortalOptions {
  children?: PortalChild[];
  modules?: PortalModules;
  asOf?: string;
  attendance?: PortalAttendanceRow[];
  invoices?: PortalInvoice[];
  receipts?: PortalReceipt[];
  vouchers?: PortalVoucher[];
  leaveTypes?: PortalLeaveType[];
  leaveRequests?: PortalLeaveRequest[];
  results?: PortalResult[];
  admitCards?: PortalAdmitCard[];
  notices?: PortalNotice[];
  notifications?: PortalNotification[];
}

export class PortalStore {
  readonly children: PortalChild[];
  readonly modules: PortalModules;
  readonly asOf: string;
  readonly attendance: PortalAttendanceRow[];
  readonly invoices: PortalInvoice[];
  readonly receipts: PortalReceipt[];
  readonly vouchers: PortalVoucher[];
  readonly leaveTypes: PortalLeaveType[];
  readonly leaveRequests: PortalLeaveRequest[];
  readonly results: PortalResult[];
  readonly admitCards: PortalAdmitCard[];
  readonly notices: PortalNotice[];
  readonly notifications: PortalNotification[];
  readonly preferences: PreferenceRow[] = buildPreferenceMatrix();
  /** Ids the guardian opened (`:mark-read`), and the `before` each `:mark-all-read` carried. */
  readonly markedRead: string[] = [];
  readonly markAllBefore: (string | undefined)[] = [];
  /** The `Authorization` header each receipt download carried (undefined when it sent none). */
  readonly downloadAuthorizations: (string | undefined)[] = [];
  /** The password a change must name as the current one. */
  readonly password = "current-secret-1";
  /** The bodies of every accepted `POST /auth/change-password`. */
  readonly passwordChanges: { current_password: string; new_password: string }[] = [];
  /** The bodies of every `POST /leave-requests` the stub accepted. */
  readonly leaveSubmissions: Record<string, unknown>[] = [];
  /** Notices acknowledged (`:acknowledge`). */
  readonly acknowledged: string[] = [];

  constructor(options: PortalOptions = {}) {
    this.children = options.children ?? [AYESHA, BILAL];
    this.modules = options.modules ?? ALL_PORTAL_MODULES_ON;
    this.asOf = options.asOf ?? PORTAL_AS_OF;
    this.attendance = options.attendance ?? [];
    this.invoices = options.invoices ?? [];
    this.receipts = options.receipts ?? [];
    this.vouchers = options.vouchers ?? [];
    this.leaveTypes = options.leaveTypes ?? buildPortalLeaveTypes();
    this.leaveRequests = options.leaveRequests ?? [];
    this.results = options.results ?? [];
    this.admitCards = options.admitCards ?? [];
    this.notices = options.notices ?? [];
    this.notifications = options.notifications ?? [];
  }

  unreadCount(): number {
    return this.notifications.filter((row) => row.read_at === null).length;
  }

  /** `GET /parent-portal/dashboard`: the cards are the seeded children's own. */
  dashboard(): PortalDashboard {
    return {
      as_of: this.asOf,
      children: this.children,
      unread_notifications: this.unreadCount(),
      unread_threads: this.modules.communication ? 0 : null,
      modules: this.modules,
    };
  }

  /** Stamps one row read; `undefined` for an id that is not in the inbox. */
  markRead(id: string): string | undefined {
    const row = this.notifications.find((candidate) => candidate.id === id);
    if (!row) return undefined;
    this.markedRead.push(id);
    row.read_at ??= new Date().toISOString();
    return row.read_at;
  }

  /** Marks every unread row created at or before `before` (default: now); returns how many. */
  markAllRead(before: string | undefined): number {
    this.markAllBefore.push(before);
    const cutoff = before === undefined ? Number.POSITIVE_INFINITY : Date.parse(before);
    let marked = 0;
    for (const row of this.notifications) {
      if (row.read_at === null && Date.parse(row.created_at) <= cutoff) {
        row.read_at = new Date().toISOString();
        marked += 1;
      }
    }
    return marked;
  }

  /** Records the caller's acknowledgment; `false` for a notice that is not theirs to read. */
  acknowledge(id: string): boolean {
    const notice = this.notices.find((candidate) => candidate.id === id);
    if (!notice) return false;
    this.acknowledged.push(id);
    notice.acknowledged_at ??= new Date().toISOString();
    return true;
  }

  setPreference(category: string, channel: string, isEnabled: boolean): void {
    const row = this.preferences.find(
      (candidate) => candidate.event_category === category && candidate.channel === channel,
    );
    if (row) row.is_enabled = isEnabled;
  }
}
