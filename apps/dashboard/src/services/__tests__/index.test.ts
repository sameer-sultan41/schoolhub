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
      "auth",
      "dashboard",
      "files",
      "guardians",
      "jobs",
      "schoolOrganization",
      "staff",
      "studentTransfers",
      "students",
      "tenant",
    ]);

    expect(typeof Services.auth.login).toBe("function");
    expect(typeof Services.auth.logout).toBe("function");
    expect(typeof Services.auth.fetchCurrentUser).toBe("function");
    expect(typeof Services.auth.restoreSession).toBe("function");

    expect(typeof Services.tenant.fetchCurrentTenant).toBe("function");

    expect(typeof Services.dashboard.fetchDashboardOverview).toBe("function");

    expect(typeof Services.files.uploadFile).toBe("function");

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

    expect(typeof Services.studentTransfers.fetchStudentTransfers).toBe("function");
    expect(typeof Services.studentTransfers.requestTransfer).toBe("function");
    expect(typeof Services.studentTransfers.approveTransfer).toBe("function");
    expect(typeof Services.studentTransfers.rejectTransfer).toBe("function");
    expect(typeof Services.studentTransfers.completeTransfer).toBe("function");
  });
});
