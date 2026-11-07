import { servicesMock } from "@/test-fixtures/services-mock";

/** The `@/services` mock the fees-setup tests share: each test file's `jest.mock` factory
 * reaches it through `jest.requireActual`. */
export function feesServicesMock() {
  return servicesMock({
    auth: ["fetchCurrentUser"],
    ledgerAccounts: [
      "listLedgerAccounts",
      "fetchLedgerAccountOptions",
      "createLedgerAccount",
      "updateLedgerAccount",
      "deleteLedgerAccount",
    ],
    feeHeads: [
      "listFeeHeads",
      "fetchFeeHeadOptions",
      "createFeeHead",
      "updateFeeHead",
      "deleteFeeHead",
    ],
    feeStructures: [
      "listFeeStructures",
      "fetchFeeStructure",
      "createFeeStructure",
      "updateFeeStructure",
      "deleteFeeStructure",
      "activateFeeStructure",
      "archiveFeeStructure",
    ],
    feeSchedules: ["createFeeSchedule", "updateFeeSchedule", "deleteFeeSchedule"],
    schoolOrganization: ["fetchAcademicSessions", "fetchClasses", "fetchTerms"],
    dashboard: ["fetchCampuses"],
  });
}
