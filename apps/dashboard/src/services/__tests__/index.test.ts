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
      "curriculum",
      "dashboard",
      "examSchedules",
      "examSubjects",
      "exams",
      "files",
      "gradingScales",
      "guardians",
      "jobs",
      "leaveRequests",
      "marks",
      "periods",
      "promotions",
      "rooms",
      "schoolOrganization",
      "staff",
      "staffAttendance",
      "studentAttendance",
      "studentTransfers",
      "students",
      "teacherAllocations",
      "teacherSubstitutions",
      "tenant",
      "timetableSlots",
    ]);

    expect(typeof Services.auth.login).toBe("function");
    expect(typeof Services.auth.logout).toBe("function");
    expect(typeof Services.auth.fetchCurrentUser).toBe("function");
    expect(typeof Services.auth.restoreSession).toBe("function");

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
    expect(typeof Services.schoolOrganization.fetchTerms).toBe("function");
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
