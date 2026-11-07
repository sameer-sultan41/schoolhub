import { AdmitCardsService } from "./modules/admit-cards";
import { FeeHeadsService } from "./modules/fee-heads";
import { FeeInvoicesService } from "./modules/fee-invoices";
import { FeeSchedulesService } from "./modules/fee-schedules";
import { FeeStructuresService } from "./modules/fee-structures";
import { LedgerAccountsService } from "./modules/ledger-accounts";
import { NoticesService } from "./modules/notices";
import { NotificationPreferencesService } from "./modules/notification-preferences";
import { NotificationsService } from "./modules/notifications";
import { ParentPortalService } from "./modules/parent-portal";
import { ReceiptsService } from "./modules/receipts";
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

export type {
  DocumentVerificationDecision,
  EmergencyContactRecord,
  StudentDocumentRecord,
  StudentRecord,
} from "./modules/students";

export type {
  FeeFrequency,
  FeeScheduleInput,
  FeeScheduleRecord,
  FeeSchedulesQuery,
} from "./modules/fee-schedules";
export type {
  FeeHeadCategory,
  FeeHeadInput,
  FeeHeadRecord,
  FeeHeadsQuery,
} from "./modules/fee-heads";
export type {
  FeeStructureInput,
  FeeStructureRecord,
  FeeStructureStatus,
  FeeStructuresQuery,
} from "./modules/fee-structures";
export type {
  LedgerAccountInput,
  LedgerAccountRecord,
  LedgerAccountsQuery,
  LedgerAccountType,
} from "./modules/ledger-accounts";

export type { ExamInput, ExamPageQuery, ExamRecord, ExamStatus, ExamType } from "./modules/exams";

export type {
  AdmitCardIssue,
  AdmitCardPageQuery,
  AdmitCardRecord,
  AdmitCardStatus,
} from "./modules/admit-cards";

export type {
  BulkMarksEntryInput,
  BulkMarksEntryResult,
  MarksEntryInput,
  MarksEntryStatus,
  MarksGrid,
  MarksGridEntry,
  MarksGridMeta,
  MarksGridQuery,
  MarksLockResult,
  MarksProgressRow,
  MarksRecord,
  MarksUnlockResult,
  MarksUnwritableReason,
} from "./modules/marks";

export type {
  ResultOutcome,
  ResultPageQuery,
  ResultRecord,
  ResultsApproved,
  ResultsPublished,
  ResultsSentBack,
  ResultStatus,
} from "./modules/exam-results";

export type {
  ReportCardPageQuery,
  ReportCardRecord,
  ReportCardRemarkField,
  ReportCardRemarksInput,
  ReportCardsPublished,
  ReportCardStatus,
} from "./modules/report-cards";

export type {
  ConflictSeverity as ExamConflictSeverity,
  ExamConflict,
  ExamConflictType,
  SchedulePublishResult,
  SittingDay,
  SittingInput,
  SittingRecord,
  SittingStatus,
  SittingWriteResult,
} from "./modules/exam-schedules";

export type {
  ExamSubjectGroup,
  ExamSubjectInput,
  ExamSubjectRecord,
} from "./modules/exam-subjects";

export type {
  CloneCurriculumResult,
  CurriculumInput,
  CurriculumPageQuery,
  CurriculumRecord,
} from "./modules/curriculum";

export type {
  CreatePromotionBatchInput,
  PromotionAction,
  PromotionBatchCreated,
  PromotionBatchDetail,
  PromotionBatchesQuery,
  PromotionBatchRecord,
  PromotionDecisionRecord,
  PromotionDecisionValue,
  PromotionExecutionReport,
  PromotionProposal,
  PromotionStatus,
  PromotionTransition,
  PromotionTransitionResult,
  UpdateDecisionInput,
} from "./modules/promotions";

export type {
  AttendanceMode,
  AttendanceSettings,
  AttendanceSettingsInput,
} from "./modules/attendance-settings";

export type {
  AttendanceCorrectionRecord,
  CorrectionAction,
  CorrectionChange,
  CorrectionNewValues,
  CorrectionPageQuery,
  CorrectionStatus,
  CorrectionSubjectType,
  RequestCorrectionInput,
} from "./modules/attendance-corrections";

export type {
  ExamInlineReport,
  ExamQueuedReport,
  ExamReportFormValues,
  ExamReportKind,
  ExamReportQuery,
  ExamReportRow,
  ExamReportRowOf,
  ExamReportRun,
} from "./modules/exam-reports";

export type {
  AttendanceReportRow,
  InlineReport,
  QueuedReport,
  ReportFormat,
  ReportFormValues,
  ReportKind,
  ReportKindFields,
  ReportQuery,
  ReportRowOf,
  ReportRun,
} from "./modules/attendance-reports";

export type {
  LeaveAction,
  LeaveApprovalDecision,
  LeaveApprovalRecord,
  LeaveCreateInput,
  LeaveDayPart,
  LeaveDecisionResult,
  LeavePageQuery,
  LeaveRequestRecord,
  LeaveStatus,
  LeaveTypeOption,
  LeaveTypeRecord,
} from "./modules/leave-requests";

export type {
  AttendancePageQuery,
  AttendanceStatus,
  BulkMarkEntryInput,
  BulkMarkInput,
  BulkMarkMeta,
  BulkMarkResult,
  MarkableStatus,
  MyRegister,
  MyRegistersResult,
  RegisterEntry,
  RegisterMeta,
  RegisterQuery,
  RegisterResult,
  StudentAttendanceRecord,
  UnmarkableReason,
} from "./modules/student-attendance";

/** One refused row of a whole-grid submission (attendance's `:bulk-mark`, marks' `:bulk-entry`). */
export type { RowIssue } from "./shared/row-issues";

export type {
  MarkableStaffStatus,
  MarkStaffAttendanceInput,
  StaffAttendancePageQuery,
  StaffAttendanceRecord,
  StaffAttendanceStatus,
  StaffRegisterEntry,
  StaffRegisterQuery,
  StaffRowDraft,
} from "./modules/staff-attendance";

export type {
  CoverageIssue,
  GradeBandInput,
  GradeBandRecord,
  GradingScaleInput,
  GradingScalePageQuery,
  GradingScaleRecord,
  GradingScaleType,
} from "./modules/grading-scales";

export type {
  PaperBlueprint,
  PaperResult,
  PaperShortfall,
  QuestionBankInput,
  QuestionBankPageQuery,
  QuestionBankRecord,
  QuestionBankStatus,
  QuestionDifficulty,
  QuestionInput,
  QuestionPageQuery,
  QuestionRecord,
  QuestionSource,
  QuestionType,
} from "./modules/question-banks";

export type { PeriodInput, PeriodPageQuery, PeriodRecord } from "./modules/periods";

export type { RoomInput, RoomPageQuery, RoomRecord, RoomType } from "./modules/rooms";

export type {
  ConflictSeverity,
  EffectiveSlotRecord,
  SlotInput,
  SlotWriteResult,
  TimetableConflict,
  TimetablePublishResult,
  TimetableSlotRecord,
  TimetableValidation,
} from "./modules/timetable-slots";

export type {
  AcademicSessionSummary,
  SchoolOrganizationOption,
  SectionOption,
} from "./modules/school-organization";

export type {
  AllocateTeacherInput,
  AllocationSaveResult,
  TeacherAllocationPageQuery,
  TeacherAllocationRecord,
  TeacherLoadRow,
  TeacherLoadWarning,
  UpdateAllocationInput,
} from "./modules/teacher-allocations";

export type {
  ProposeSubstitutionInput,
  SubstituteCandidate,
  SubstitutionAction,
  SubstitutionPageQuery,
  SubstitutionStatus,
  TeacherSubstitutionRecord,
} from "./modules/teacher-substitutions";

/** `UpdateGuardianLinkInput` is re-exported here (not just from the guardians module
 * itself) because Task 7's `GuardianLinkFlagsDialog` imports it from `@/services`, not
 * from the guardians module directly (ADR-0011: feature code imports only `@/services`,
 * never a service module's own path). */
export type {
  GuardianLinkRecord,
  GuardianRecord,
  GuardianRelationship,
  UpdateGuardianLinkInput,
} from "./modules/guardians";

export type {
  PortalChild,
  PortalDashboard,
  PortalModuleKey,
  PortalModules,
  PortalStudent,
} from "./modules/parent-portal";

export type {
  NotificationCategory,
  NotificationPriority,
  NotificationRecord,
  NotificationsQuery,
} from "./modules/notifications";

export type { NoticeRead, NoticeType, PortalNoticeRecord } from "./modules/notices";
export type {
  NotificationChannel,
  NotificationPreferenceRow,
} from "./modules/notification-preferences";
export type { FeeInvoiceRecord } from "./modules/fee-invoices";
export type { ReceiptFormat, ReceiptRecord } from "./modules/receipts";
export type { VoucherFormat, VoucherRecord, VoucherStatus } from "./modules/vouchers";

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
  ledgerAccounts: LedgerAccountsService,
  feeHeads: FeeHeadsService,
  feeStructures: FeeStructuresService,
  feeSchedules: FeeSchedulesService,
  receipts: ReceiptsService,
  vouchers: VouchersService,
  results: ResultsService,
} as const;
