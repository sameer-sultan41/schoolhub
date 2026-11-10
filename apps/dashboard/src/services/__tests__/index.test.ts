import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";
import { Services } from "@/services";

/**
 * The real `Services` aggregate — every domain's call sites mock `@/services` to isolate
 * themselves, so this is the one place the real wiring (this file, plus each
 * `modules/<domain>/index.ts`) is proven correct: every action a call site names actually
 * resolves to a function, through the real barrels, not a typo one mock away from being
 * invisible.
 *
 * `@schoolhub/api-client` is still mocked, same reason every service test mocks it:
 * `@/lib/auth` builds a real `ApiClient` at module scope (`createApiClient(...)`), which
 * binds `globalThis.fetch` — absent under jsdom — so importing it unmocked crashes before
 * any of this file's own assertions run.
 */
jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({
      get: jest.fn(),
      post: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
    })),
    refreshAccessToken: jest.fn(),
  };
});

describe("Services", () => {
  it("aggregates every domain, each action a real function", () => {
    expect(Object.keys(Services).sort()).toEqual([
      "admitCards",
      "attendanceCorrections",
      "attendanceReports",
      "attendanceSettings",
      "auth",
      "broadcasts",
      "budgets",
      "curriculum",
      "dashboard",
      "discounts",
      "examReports",
      "examResults",
      "examSchedules",
      "examSubjects",
      "exams",
      "expenseCategories",
      "expenses",
      "feeHeads",
      "feeInvoices",
      "feeSchedules",
      "feeStructures",
      "files",
      "fines",
      "gradingScales",
      "guardians",
      "jobs",
      "leaveRequests",
      "ledgerAccounts",
      "marks",
      "messageThreads",
      "notices",
      "notificationPreferences",
      "notifications",
      "parentPortal",
      "payments",
      "periods",
      "promotions",
      "questionBanks",
      "receipts",
      "refunds",
      "reportCards",
      "results",
      "rooms",
      "scholarships",
      "schoolOrganization",
      "settlementImports",
      "staff",
      "staffAttendance",
      "studentAttendance",
      "studentTransfers",
      "students",
      "teacherAllocations",
      "teacherSubstitutions",
      "tenant",
      "threadOversight",
      "timetableSlots",
      "vouchers",
    ]);

    expect(typeof Services.auth.login).toBe("function");
    expect(typeof Services.auth.logout).toBe("function");
    expect(typeof Services.auth.fetchCurrentUser).toBe("function");
    expect(typeof Services.auth.restoreSession).toBe("function");
    expect(typeof Services.auth.changePassword).toBe("function");

    expect(typeof Services.vouchers.listVouchers).toBe("function");
    expect(typeof Services.vouchers.downloadVoucher).toBe("function");
    expect(typeof Services.vouchers.issueVoucher).toBe("function");
    expect(typeof Services.vouchers.voidVoucher).toBe("function");
    expect(typeof Services.expenseCategories.listExpenseCategories).toBe("function");
    expect(typeof Services.expenseCategories.deleteExpenseCategory).toBe("function");
    expect(typeof Services.expenses.listExpenses).toBe("function");
    expect(typeof Services.expenses.submitExpense).toBe("function");
    expect(typeof Services.expenses.approveExpense).toBe("function");
    expect(typeof Services.expenses.rejectExpense).toBe("function");
    expect(typeof Services.expenses.markExpensePaid).toBe("function");
    expect(typeof Services.expenses.reverseExpense).toBe("function");
    expect(typeof Services.budgets.listBudgets).toBe("function");
    expect(typeof Services.budgets.approveBudget).toBe("function");
    expect(typeof Services.refunds.listRefunds).toBe("function");
    expect(typeof Services.refunds.createRefund).toBe("function");
    expect(typeof Services.refunds.approveRefund).toBe("function");
    expect(typeof Services.refunds.rejectRefund).toBe("function");
    expect(typeof Services.refunds.processRefund).toBe("function");
    expect(typeof Services.settlementImports.listSettlementImports).toBe("function");
    expect(typeof Services.settlementImports.fetchSettlementImport).toBe("function");
    expect(typeof Services.settlementImports.uploadSettlementImport).toBe("function");
    expect(typeof Services.leaveRequests.createLeave).toBe("function");
    expect(typeof Services.leaveRequests.cancelLeave).toBe("function");

    expect(typeof Services.tenant.fetchCurrentTenant).toBe("function");

    expect(typeof Services.dashboard.fetchDashboardOverview).toBe("function");

    expect(typeof Services.files.uploadFile).toBe("function");

    expect(typeof Services.exams.fetchExamsPage).toBe("function");
    expect(typeof Services.exams.fetchExam).toBe("function");
    expect(typeof Services.exams.createExam).toBe("function");
    expect(typeof Services.exams.updateExam).toBe("function");
    expect(typeof Services.exams.deleteExam).toBe("function");
    expect(typeof Services.examSubjects.fetchExamSubjects).toBe("function");
    expect(typeof Services.examSubjects.createExamSubject).toBe("function");
    expect(typeof Services.examSubjects.updateExamSubject).toBe("function");
    expect(typeof Services.examSubjects.deleteExamSubject).toBe("function");
    expect(typeof Services.examSchedules.fetchSittings).toBe("function");
    expect(typeof Services.examSchedules.createSitting).toBe("function");
    expect(typeof Services.examSchedules.updateSitting).toBe("function");
    expect(typeof Services.examSchedules.cancelSitting).toBe("function");
    expect(typeof Services.examSchedules.deleteSitting).toBe("function");
    expect(typeof Services.examSchedules.fetchConflicts).toBe("function");
    expect(typeof Services.examSchedules.publishSchedule).toBe("function");
    expect(typeof Services.admitCards.fetchAdmitCardsPage).toBe("function");
    expect(typeof Services.admitCards.issueAdmitCards).toBe("function");
    expect(typeof Services.admitCards.revokeAdmitCard).toBe("function");
    expect(typeof Services.admitCards.fetchAdmitCardDownloadUrl).toBe("function");
    expect(typeof Services.marks.fetchGrid).toBe("function");
    expect(typeof Services.marks.bulkEntry).toBe("function");
    expect(typeof Services.marks.fetchProgress).toBe("function");
    expect(typeof Services.marks.lockMarks).toBe("function");
    expect(typeof Services.marks.unlockMarks).toBe("function");
    expect(typeof Services.marks.importMarks).toBe("function");
    expect(typeof Services.marks.fetchStudentMarks).toBe("function");
    expect(typeof Services.examResults.fetchResultsPage).toBe("function");
    expect(typeof Services.examResults.processResults).toBe("function");
    expect(typeof Services.examResults.approveResults).toBe("function");
    expect(typeof Services.examResults.sendResultsBack).toBe("function");
    expect(typeof Services.examResults.publishResults).toBe("function");
    expect(typeof Services.examResults.withholdResult).toBe("function");
    expect(typeof Services.reportCards.fetchReportCardsPage).toBe("function");
    expect(typeof Services.reportCards.generateReportCards).toBe("function");
    expect(typeof Services.reportCards.publishReportCards).toBe("function");
    expect(typeof Services.reportCards.updateRemarks).toBe("function");
    expect(typeof Services.reportCards.fetchReportCardDownloadUrl).toBe("function");
    expect(typeof Services.examReports.runReport).toBe("function");
    expect(typeof Services.examReports.exportReport).toBe("function");
    expect(typeof Services.schoolOrganization.fetchTerms).toBe("function");
    expect(typeof Services.questionBanks.fetchBanksPage).toBe("function");
    expect(typeof Services.questionBanks.fetchBank).toBe("function");
    expect(typeof Services.questionBanks.createBank).toBe("function");
    expect(typeof Services.questionBanks.updateBank).toBe("function");
    expect(typeof Services.questionBanks.deleteBank).toBe("function");
    expect(typeof Services.questionBanks.fetchQuestionsPage).toBe("function");
    expect(typeof Services.questionBanks.createQuestion).toBe("function");
    expect(typeof Services.questionBanks.updateQuestion).toBe("function");
    expect(typeof Services.questionBanks.deleteQuestion).toBe("function");
    expect(typeof Services.questionBanks.approveQuestion).toBe("function");
    expect(typeof Services.questionBanks.assemblePaper).toBe("function");
    expect(typeof Services.gradingScales.fetchScalesPage).toBe("function");
    expect(typeof Services.gradingScales.fetchScale).toBe("function");
    expect(typeof Services.gradingScales.createScale).toBe("function");
    expect(typeof Services.gradingScales.updateScale).toBe("function");
    expect(typeof Services.gradingScales.deleteScale).toBe("function");
    expect(typeof Services.gradingScales.setDefault).toBe("function");
    expect(typeof Services.gradingScales.fetchBands).toBe("function");
    expect(typeof Services.gradingScales.createBand).toBe("function");
    expect(typeof Services.gradingScales.updateBand).toBe("function");
    expect(typeof Services.gradingScales.deleteBand).toBe("function");

    expect(typeof Services.jobs.fetchJob).toBe("function");
    expect(typeof Services.jobs.fetchFileDownloadUrl).toBe("function");

    expect(typeof Services.staff.fetchStaffDirectory).toBe("function");
    expect(typeof Services.staff.fetchStaffPage).toBe("function");
    expect(typeof Services.staff.createStaff).toBe("function");
    expect(typeof Services.staff.updateStaff).toBe("function");
    expect(typeof Services.staff.exitStaff).toBe("function");
    expect(typeof Services.staff.fetchStaffById).toBe("function");
    expect(typeof Services.staff.triggerStaffExport).toBe("function");
    expect(typeof Services.staff.triggerStaffImport).toBe("function");
    expect(typeof Services.staff.fetchTeachingStaffOptions).toBe("function");

    expect(typeof Services.schoolOrganization.fetchHouses).toBe("function");

    expect(typeof Services.guardians.searchGuardians).toBe("function");
    expect(typeof Services.guardians.fetchGuardianById).toBe("function");
    expect(typeof Services.guardians.createGuardian).toBe("function");
    expect(typeof Services.guardians.updateGuardian).toBe("function");
    expect(typeof Services.guardians.linkGuardianToStudent).toBe("function");
    expect(typeof Services.guardians.updateGuardianLink).toBe("function");
    expect(typeof Services.guardians.fetchGuardianLinks).toBe("function");

    expect(typeof Services.students.fetchStudentsPage).toBe("function");
    expect(typeof Services.students.fetchStudentById).toBe("function");
    expect(typeof Services.students.createStudent).toBe("function");
    expect(typeof Services.students.updateStudent).toBe("function");
    expect(typeof Services.students.withdrawStudent).toBe("function");
    expect(typeof Services.students.enrollStudent).toBe("function");
    expect(typeof Services.students.changeStudentSection).toBe("function");
    expect(typeof Services.students.fetchStudentHistory).toBe("function");
    expect(typeof Services.students.triggerStudentImport).toBe("function");
    expect(typeof Services.students.triggerStudentExport).toBe("function");
    expect(typeof Services.students.generateIdCards).toBe("function");

    expect(typeof Services.studentTransfers.fetchStudentTransfers).toBe("function");
    expect(typeof Services.studentTransfers.requestTransfer).toBe("function");
    expect(typeof Services.studentTransfers.approveTransfer).toBe("function");
    expect(typeof Services.studentTransfers.rejectTransfer).toBe("function");
    expect(typeof Services.studentTransfers.completeTransfer).toBe("function");

    expect(typeof Services.teacherAllocations.fetchAllocationsPage).toBe("function");
    expect(typeof Services.teacherAllocations.allocateTeacher).toBe("function");
    expect(typeof Services.teacherAllocations.updateAllocation).toBe("function");
    expect(typeof Services.teacherAllocations.endAllocation).toBe("function");
    expect(typeof Services.teacherAllocations.reinstateAllocation).toBe("function");
    expect(typeof Services.teacherAllocations.deleteAllocation).toBe("function");
    expect(typeof Services.teacherAllocations.fetchLoadSummary).toBe("function");
    expect(typeof Services.teacherAllocations.fetchSectionAllocations).toBe("function");

    expect(typeof Services.periods.fetchPeriodPage).toBe("function");
    expect(typeof Services.periods.fetchCampusPeriods).toBe("function");
    expect(typeof Services.periods.createPeriod).toBe("function");
    expect(typeof Services.periods.updatePeriod).toBe("function");
    expect(typeof Services.periods.deletePeriod).toBe("function");

    expect(typeof Services.rooms.fetchRoomPage).toBe("function");
    expect(typeof Services.rooms.fetchActiveRooms).toBe("function");
    expect(typeof Services.rooms.createRoom).toBe("function");
    expect(typeof Services.rooms.updateRoom).toBe("function");
    expect(typeof Services.rooms.deleteRoom).toBe("function");

    expect(typeof Services.timetableSlots.fetchSectionSlots).toBe("function");
    expect(typeof Services.timetableSlots.createSlot).toBe("function");
    expect(typeof Services.timetableSlots.updateSlot).toBe("function");
    expect(typeof Services.timetableSlots.deleteSlot).toBe("function");
    expect(typeof Services.timetableSlots.validateSection).toBe("function");
    expect(typeof Services.timetableSlots.publishSection).toBe("function");

    expect(typeof Services.parentPortal.fetchPortalDashboard).toBe("function");
    expect(typeof Services.notifications.listNotifications).toBe("function");
    expect(typeof Services.notifications.fetchUnreadCount).toBe("function");
    expect(typeof Services.notifications.markNotificationRead).toBe("function");
    expect(typeof Services.notifications.markAllNotificationsRead).toBe("function");
    expect(typeof Services.notificationPreferences.fetchNotificationPreferences).toBe("function");
    expect(typeof Services.notificationPreferences.updateNotificationPreferences).toBe("function");
    expect(typeof Services.notices.listNotices).toBe("function");
    expect(typeof Services.notices.acknowledgeNotice).toBe("function");
    expect(typeof Services.feeInvoices.listFeeInvoices).toBe("function");
    expect(typeof Services.feeInvoices.generateFeeInvoices).toBe("function");
    expect(typeof Services.feeInvoices.cancelFeeInvoice).toBe("function");
    expect(typeof Services.payments.listPayments).toBe("function");
    expect(typeof Services.payments.recordPayment).toBe("function");
    expect(typeof Services.ledgerAccounts.listLedgerAccounts).toBe("function");
    expect(typeof Services.ledgerAccounts.fetchLedgerAccount).toBe("function");
    expect(typeof Services.ledgerAccounts.createLedgerAccount).toBe("function");
    expect(typeof Services.ledgerAccounts.updateLedgerAccount).toBe("function");
    expect(typeof Services.ledgerAccounts.deleteLedgerAccount).toBe("function");
    expect(typeof Services.feeHeads.listFeeHeads).toBe("function");
    expect(typeof Services.feeHeads.fetchFeeHead).toBe("function");
    expect(typeof Services.feeHeads.createFeeHead).toBe("function");
    expect(typeof Services.feeHeads.updateFeeHead).toBe("function");
    expect(typeof Services.feeHeads.deleteFeeHead).toBe("function");
    expect(typeof Services.feeStructures.listFeeStructures).toBe("function");
    expect(typeof Services.feeStructures.fetchFeeStructure).toBe("function");
    expect(typeof Services.feeStructures.createFeeStructure).toBe("function");
    expect(typeof Services.feeStructures.updateFeeStructure).toBe("function");
    expect(typeof Services.feeStructures.deleteFeeStructure).toBe("function");
    expect(typeof Services.feeStructures.activateFeeStructure).toBe("function");
    expect(typeof Services.feeStructures.archiveFeeStructure).toBe("function");
    expect(typeof Services.discounts.listDiscounts).toBe("function");
    expect(typeof Services.discounts.createDiscount).toBe("function");
    expect(typeof Services.discounts.updateDiscount).toBe("function");
    expect(typeof Services.discounts.revokeDiscount).toBe("function");
    expect(typeof Services.scholarships.listScholarships).toBe("function");
    expect(typeof Services.scholarships.createScholarship).toBe("function");
    expect(typeof Services.scholarships.updateScholarship).toBe("function");
    expect(typeof Services.fines.listFines).toBe("function");
    expect(typeof Services.fines.createFine).toBe("function");
    expect(typeof Services.fines.updateFine).toBe("function");
    expect(typeof Services.fines.waiveFine).toBe("function");
    expect(typeof Services.feeSchedules.listFeeSchedules).toBe("function");
    expect(typeof Services.feeSchedules.fetchFeeSchedule).toBe("function");
    expect(typeof Services.feeSchedules.createFeeSchedule).toBe("function");
    expect(typeof Services.feeSchedules.updateFeeSchedule).toBe("function");
    expect(typeof Services.feeSchedules.deleteFeeSchedule).toBe("function");
    expect(typeof Services.receipts.listReceipts).toBe("function");
    expect(typeof Services.receipts.downloadReceipt).toBe("function");
    expect(typeof Services.results.listResults).toBe("function");
    expect(typeof Services.timetableSlots.fetchMyTimetable).toBe("function");
    expect(typeof Services.timetableSlots.fetchTeacherClassesOn).toBe("function");

    expect(typeof Services.teacherSubstitutions.fetchSubstitutionPage).toBe("function");
    expect(typeof Services.teacherSubstitutions.proposeSubstitution).toBe("function");
    expect(typeof Services.teacherSubstitutions.fetchCandidates).toBe("function");
    expect(typeof Services.teacherSubstitutions.decideSubstitution).toBe("function");

    expect(typeof Services.attendanceSettings.fetchSettings).toBe("function");
    expect(typeof Services.attendanceSettings.updateSettings).toBe("function");

    expect(typeof Services.studentAttendance.fetchRegister).toBe("function");
    expect(typeof Services.studentAttendance.fetchMyRegisters).toBe("function");
    expect(typeof Services.studentAttendance.fetchAttendancePage).toBe("function");
    expect(typeof Services.studentAttendance.bulkMark).toBe("function");
    expect(typeof Services.studentAttendance.triggerAttendanceImport).toBe("function");

    expect(typeof Services.staffAttendance.fetchStaffRegister).toBe("function");
    expect(typeof Services.staffAttendance.fetchStaffAttendancePage).toBe("function");
    expect(typeof Services.staffAttendance.markStaffAttendance).toBe("function");
    expect(typeof Services.staffAttendance.checkOutStaff).toBe("function");

    expect(typeof Services.attendanceCorrections.requestCorrection).toBe("function");
    expect(typeof Services.attendanceCorrections.fetchCorrectionPage).toBe("function");
    expect(typeof Services.attendanceCorrections.decideCorrection).toBe("function");

    expect(typeof Services.leaveRequests.fetchLeavePage).toBe("function");
    expect(typeof Services.leaveRequests.fetchLeaveTypes).toBe("function");
    expect(typeof Services.leaveRequests.decideLeave).toBe("function");

    expect(typeof Services.messageThreads.listThreads).toBe("function");
    expect(typeof Services.messageThreads.fetchThread).toBe("function");
    expect(typeof Services.messageThreads.createThread).toBe("function");
    expect(typeof Services.messageThreads.listMessages).toBe("function");
    expect(typeof Services.messageThreads.postMessage).toBe("function");
    expect(typeof Services.messageThreads.markRead).toBe("function");
    expect(typeof Services.messageThreads.closeThread).toBe("function");
    expect(typeof Services.messageThreads.reopenThread).toBe("function");
    expect(typeof Services.messageThreads.searchRecipients).toBe("function");
    expect(typeof Services.messageThreads.downloadAttachment).toBe("function");

    expect(typeof Services.threadOversight.listThreads).toBe("function");
    expect(typeof Services.threadOversight.fetchThread).toBe("function");
    expect(typeof Services.threadOversight.listMessages).toBe("function");
    expect(typeof Services.threadOversight.downloadAttachment).toBe("function");

    expect(typeof Services.broadcasts.preview).toBe("function");
    expect(typeof Services.broadcasts.send).toBe("function");

    expect(typeof Services.attendanceReports.runReport).toBe("function");
    expect(typeof Services.attendanceReports.exportReport).toBe("function");

    expect(typeof Services.periods.fetchPeriodPage).toBe("function");
    expect(typeof Services.periods.createPeriod).toBe("function");
    expect(typeof Services.periods.updatePeriod).toBe("function");
    expect(typeof Services.periods.deletePeriod).toBe("function");

    expect(typeof Services.rooms.fetchRoomPage).toBe("function");
    expect(typeof Services.rooms.createRoom).toBe("function");
    expect(typeof Services.rooms.updateRoom).toBe("function");
    expect(typeof Services.rooms.deleteRoom).toBe("function");

    expect(typeof Services.promotions.fetchPromotionBatches).toBe("function");
    expect(typeof Services.promotions.fetchPromotionBatch).toBe("function");
    expect(typeof Services.promotions.createPromotionBatch).toBe("function");
    expect(typeof Services.promotions.updateDecision).toBe("function");
    expect(typeof Services.promotions.transitionBatch).toBe("function");
    expect(typeof Services.promotions.executeBatch).toBe("function");
  });
});
