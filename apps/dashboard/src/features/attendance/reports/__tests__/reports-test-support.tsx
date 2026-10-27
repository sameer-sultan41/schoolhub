import type { PermissionKey } from "@schoolhub/types";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import type { BackgroundJobRecord, JobStatus } from "@/services/modules/jobs/jobs-service";
import {
  FILE_ID,
  JOB_ID,
  SECTION_ID,
} from "@/services/modules/attendance-reports/__tests__/attendance-reports-fixtures";
import { periodRecord, PERIOD_ID } from "@/services/modules/periods/__tests__/periods-fixtures";
import { CAMPUS_ID, CLASS_ID } from "@/test-fixtures/academics";
import { lastArg, mocked } from "@/test-fixtures/list-screen";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { ReportsScreen } from "../reports-screen";

/** Shared setup for the Reports tests; each file keeps its own `jest.mock` calls (hoisting). */

export { pick, rowOf, urlParam } from "@/test-fixtures/list-screen";

export const runReport = mocked(Services.attendanceReports.runReport);
export const exportReport = mocked(Services.attendanceReports.exportReport);
export const fetchJob = mocked(Services.jobs.fetchJob);
export const fetchFileDownloadUrl = mocked(Services.jobs.fetchFileDownloadUrl);
export const fetchCampusPeriods = mocked(Services.periods.fetchCampusPeriods);

export const VIEW: PermissionKey = "attendance.report.view";
export const EXPORT: PermissionKey = "attendance.report.export";

/** The class and section the student reports narrow to. */
export { CLASS_ID, SECTION_ID };
export const SECTION_NAME = "A";
export const CLASS_NAME = "Grade 5";
export { PERIOD_ID };

/** Signs in with `attendance.report.view` plus `keys`. */
export function asUser(...keys: PermissionKey[]) {
  mocked(Services.auth.fetchCurrentUser).mockResolvedValue(buildUser([VIEW, ...keys]));
}

/** A report job at `status`; a succeeded one carries the file. */
export function reportJob(status: JobStatus, overrides: Partial<BackgroundJobRecord> = {}) {
  return {
    id: JOB_ID,
    job_type: "attendance.report-export",
    status,
    progress: status === "succeeded" ? 100 : 40,
    result:
      status === "succeeded"
        ? { result_file_id: FILE_ID, rows: 1200, format: "csv", attendance_mode: "daily" }
        : null,
    error: null,
    ...overrides,
  } satisfies BackgroundJobRecord;
}

/** The `beforeEach` of every Reports test: a viewer on the bare Reports page. */
export function stubReportsServices(url = "/attendance/reports") {
  jest.clearAllMocks();
  setUrl(url);
  asUser();
  mocked(Services.schoolOrganization.fetchClasses).mockResolvedValue([
    { id: CLASS_ID, name: CLASS_NAME },
  ]);
  mocked(Services.schoolOrganization.fetchSections).mockResolvedValue([
    { id: SECTION_ID, name: SECTION_NAME, campus_id: CAMPUS_ID },
  ]);
  fetchCampusPeriods.mockResolvedValue([
    periodRecord({ id: PERIOD_ID, name: "Period 1" }),
    periodRecord({ id: "8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e20", name: "Recess", is_break: true }),
  ]);
}

export async function renderReports() {
  renderWithProviders(
    <>
      <UserLoaded />
      <ReportsScreen />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}

export const lastRun = () => lastArg(runReport);
