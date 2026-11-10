import { AdmitCardsService } from "./modules/admit-cards";
import { BudgetsService } from "./modules/budgets";
import { ExpenseCategoriesService } from "./modules/expense-categories";
import { ExpensesService } from "./modules/expenses";
import { DiscountsService } from "./modules/discounts";
import { FeeHeadsService } from "./modules/fee-heads";
import { FeeInvoicesService } from "./modules/fee-invoices";
import { FeeSchedulesService } from "./modules/fee-schedules";
import { FeeStructuresService } from "./modules/fee-structures";
import { FinesService } from "./modules/fines";
import { LedgerAccountsService } from "./modules/ledger-accounts";
import { NoticesService } from "./modules/notices";
import { NotificationPreferencesService } from "./modules/notification-preferences";
import { NotificationsService } from "./modules/notifications";
import { ParentPortalService } from "./modules/parent-portal";
import { PaymentsService } from "./modules/payments";
import { ReceiptsService } from "./modules/receipts";
import { RefundsService } from "./modules/refunds";
import { SettlementImportsService } from "./modules/settlement-imports";
import { VouchersService } from "./modules/vouchers";
import { ResultsService } from "./modules/results";
import { AttendanceCorrectionsService } from "./modules/attendance-corrections";
import { AttendanceReportsService } from "./modules/attendance-reports";
import { AttendanceSettingsService } from "./modules/attendance-settings";
import { AuthService } from "./modules/auth";
import { BroadcastsService } from "./modules/broadcasts";
import { CurriculumService } from "./modules/curriculum";
import { DashboardService } from "./modules/dashboard";
import { ExamReportsService } from "./modules/exam-reports";
import { ExamResultsService } from "./modules/exam-results";
import { ExamSchedulesService } from "./modules/exam-schedules";
import { ExamSubjectsService } from "./modules/exam-subjects";
import { ExamsService } from "./modules/exams";
import { FilesService } from "./modules/files";
import { GradingScalesService } from "./modules/grading-scales";
import { GuardiansService } from "./modules/guardians";
import { JobsService } from "./modules/jobs";
import { LeaveRequestsService } from "./modules/leave-requests";
import { MarksService } from "./modules/marks";
import { PeriodsService } from "./modules/periods";
import { PromotionsService } from "./modules/promotions";
import { QuestionBanksService } from "./modules/question-banks";
import { ReportCardsService } from "./modules/report-cards";
import { RoomsService } from "./modules/rooms";
import { ScholarshipsService } from "./modules/scholarships";
import { SchoolOrganizationService } from "./modules/school-organization";
import { StaffService } from "./modules/staff";
import { MessageThreadsService } from "./modules/message-threads";
import { StaffAttendanceService } from "./modules/staff-attendance";
import { StudentAttendanceService } from "./modules/student-attendance";
import { ThreadOversightService } from "./modules/thread-oversight";
import { StudentsService } from "./modules/students";
import { StudentTransfersService } from "./modules/student-transfers";
import { TeacherAllocationsService } from "./modules/teacher-allocations";
import { TeacherSubstitutionsService } from "./modules/teacher-substitutions";
import { TenantService } from "./modules/tenant";
import { TimetableSlotsService } from "./modules/timetable-slots";

/**
 * `ApiError` is re-exported so feature code can `instanceof`-check API failures without
 * importing `@schoolhub/api-client`. Only the transport layer — this directory and
 * `src/lib/` (the session wiring in `auth.ts`, the query client) — imports the client
 * package; everything else goes through `@/services` (ADR-0011). ESLint enforces that
 * boundary via `TRANSPORT` in `apps/dashboard/eslint.config.mjs`.
 */
export { ApiError } from "@schoolhub/api-client";

/** Every module's public types live in `./types` (this file stays under the 400-line cap). */
export * from "./types";

/** One refused row of a whole-grid submission (attendance's `:bulk-mark`, marks' `:bulk-entry`). */

/** `UpdateGuardianLinkInput` is re-exported here (not just from the guardians module
 * itself) because Task 7's `GuardianLinkFlagsDialog` imports it from `@/services`, not
 * from the guardians module directly (ADR-0011: feature code imports only `@/services`,
 * never a service module's own path). */

/**
 * Every domain's API calls, aggregated behind one object. A component imports `Services`
 * and calls `Services.<domain>.<action>(...)` — never `apiClient` and never a service
 * module's file directly — so every call site self-documents which domain it's calling
 * into (see `src/services/endpoints.ts` for the path-centralization half of this
 * convention).
 *
 * Add a domain here the moment its module lands, following the five-file
 * `services/modules/<domain>/` shape (ADR-0019) — see `students`/`staff`/`auth`.
 */
export const Services = {
  auth: AuthService,
  tenant: TenantService,
  dashboard: DashboardService,
  files: FilesService,
  jobs: JobsService,
  schoolOrganization: SchoolOrganizationService,
  curriculum: CurriculumService,
  teacherAllocations: TeacherAllocationsService,
  promotions: PromotionsService,
  periods: PeriodsService,
  rooms: RoomsService,
  timetableSlots: TimetableSlotsService,
  teacherSubstitutions: TeacherSubstitutionsService,
  attendanceSettings: AttendanceSettingsService,
  studentAttendance: StudentAttendanceService,
  staffAttendance: StaffAttendanceService,
  attendanceCorrections: AttendanceCorrectionsService,
  leaveRequests: LeaveRequestsService,
  attendanceReports: AttendanceReportsService,
  gradingScales: GradingScalesService,
  exams: ExamsService,
  examSubjects: ExamSubjectsService,
  examSchedules: ExamSchedulesService,
  admitCards: AdmitCardsService,
  marks: MarksService,
  examResults: ExamResultsService,
  examReports: ExamReportsService,
  questionBanks: QuestionBanksService,
  reportCards: ReportCardsService,
  guardians: GuardiansService,
  staff: StaffService,
  students: StudentsService,
  studentTransfers: StudentTransfersService,
  messageThreads: MessageThreadsService,
  threadOversight: ThreadOversightService,
  broadcasts: BroadcastsService,
  parentPortal: ParentPortalService,
  notifications: NotificationsService,
  notificationPreferences: NotificationPreferencesService,
  notices: NoticesService,
  feeInvoices: FeeInvoicesService,
  discounts: DiscountsService,
  scholarships: ScholarshipsService,
  fines: FinesService,
  ledgerAccounts: LedgerAccountsService,
  feeHeads: FeeHeadsService,
  feeStructures: FeeStructuresService,
  feeSchedules: FeeSchedulesService,
  payments: PaymentsService,
  receipts: ReceiptsService,
  refunds: RefundsService,
  expenseCategories: ExpenseCategoriesService,
  expenses: ExpensesService,
  budgets: BudgetsService,
  settlementImports: SettlementImportsService,
  vouchers: VouchersService,
  results: ResultsService,
} as const;
