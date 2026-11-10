/**
 * The type re-exports of every services module, behind `@/services` (re-exported by `./index`).
 * Kept apart from the `Services` aggregate so that file stays under the 400-line cap.
 */

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
export type {
  JournalInput,
  JournalLineInput,
  LedgerEntriesQuery,
  LedgerEntryRecord,
  LedgerReferenceType,
} from "./modules/ledger-entries";
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
/** `UpdateGuardianLinkInput` is exported here because feature code imports only `@/services` (ADR-0011). */
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
export type {
  FeeInvoiceLineRecord,
  FeeInvoiceRecord,
  FeeInvoicesQuery,
  FeeInvoiceStatus,
  GenerateInvoicesAccepted,
  GenerateInvoicesInput,
  GenerateInvoicesResult,
} from "./modules/fee-invoices";
export type { DiscountRecord, DiscountStatus, DiscountType } from "./modules/discounts";
export type {
  ScholarshipCoverage,
  ScholarshipRecord,
  ScholarshipStatus,
  ScholarshipType,
} from "./modules/scholarships";
export type { FineRecord, FineStatus, FineType } from "./modules/fines";
export type { PaymentMethod, PaymentRecord, PaymentStatus } from "./modules/payments";
export type { ReceiptFormat, ReceiptRecord } from "./modules/receipts";
export type { RefundRecord, RefundStatus } from "./modules/refunds";
export type { SettlementImportRecord, SettlementImportStatus } from "./modules/settlement-imports";
export type { VoucherFormat, VoucherRecord, VoucherStatus } from "./modules/vouchers";
export type {
  ExpenseCategoriesQuery,
  ExpenseCategoryInput,
  ExpenseCategoryRecord,
} from "./modules/expense-categories";
export type {
  ExpenseInput,
  ExpensePaymentMethod,
  ExpenseRecord,
  ExpensesQuery,
  ExpenseStatus,
} from "./modules/expenses";
export type { BudgetInput, BudgetRecord, BudgetsQuery, BudgetStatus } from "./modules/budgets";
