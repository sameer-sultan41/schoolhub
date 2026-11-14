import { ApiError } from "@schoolhub/api-client";
import type { PermissionKey } from "@schoolhub/types";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import type { BackgroundJobRecord, JobStatus } from "@/services/modules/jobs/jobs-service";
import { CAMPUS_ID, CLASS_ID } from "@/test-fixtures/academics";
import { mocked } from "@/test-fixtures/list-screen";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { ReportsHome } from "../reports-home";

/** Shared setup for the Reports tests; each file keeps its own `jest.mock` calls (hoisting). */

export { pick, urlParam } from "@/test-fixtures/list-screen";

export const fetchReport = mocked(Services.financeReports.fetchReport);
export const exportReport = mocked(Services.financeReports.exportReport);
export const fetchJob = mocked(Services.jobs.fetchJob);
export const fetchFileDownloadUrl = mocked(Services.jobs.fetchFileDownloadUrl);
export const fetchCampuses = mocked(Services.dashboard.fetchCampuses);
export const fetchClasses = mocked(Services.schoolOrganization.fetchClasses);
export const fetchAcademicSessions = mocked(Services.schoolOrganization.fetchAcademicSessions);

export const VIEW: PermissionKey = "fees.report.view";
export const EXPORT: PermissionKey = "fees.report.export";
/** The three reads behind the campus, session and class pickers. */
export const REFERENCE_READS: PermissionKey[] = [
  "school.campus.view",
  "school.academic-session.view",
  "school.class.view",
];

export { CAMPUS_ID, CLASS_ID };
export const SESSION_ID = "5e551011-0000-4000-8000-000000000001";
export const JOB_ID = "10b10b10-0000-4000-8000-000000000001";
export const FILE_ID = "f11ef11e-0000-4000-8000-000000000001";

/** Signs in with `fees.report.view` plus `keys`. */
export function asUser(...keys: PermissionKey[]) {
  mocked(Services.auth.fetchCurrentUser).mockResolvedValue(buildUser([VIEW, ...keys]));
}

/** A report job at `status`; a succeeded one carries the file. */
export function reportJob(status: JobStatus) {
  return {
    id: JOB_ID,
    job_type: "fees.export-report",
    status,
    progress: status === "succeeded" ? 100 : 40,
    result: status === "succeeded" ? { result_file_id: FILE_ID, rows: 1200, format: "xlsx" } : null,
    error: null,
  } satisfies BackgroundJobRecord;
}

/** The 422 a report over the inline ceiling answers with. */
export function tooLarge(limit = 1000) {
  return new ApiError({
    status: 422,
    code: "domain_rule_violation",
    message: "This report is too large to return inline.",
    url: "/reports/finance-summary",
    meta: { row_limit: limit },
  });
}

/** The `beforeEach` of every Reports test: a viewer on the bare Reports page. */
export function stubReportsServices(url = "/fees/reports") {
  jest.clearAllMocks();
  setUrl(url);
  asUser();
  fetchReport.mockResolvedValue({ kind: "collection", rows: [] });
  fetchCampuses.mockResolvedValue([{ id: CAMPUS_ID, name: "North campus" }] as Awaited<
    ReturnType<typeof fetchCampuses>
  >);
  fetchClasses.mockResolvedValue([{ id: CLASS_ID, name: "Grade 5" }]);
  fetchAcademicSessions.mockResolvedValue([
    { id: SESSION_ID, name: "2026-27", is_current: true, status: "active" },
  ] as Awaited<ReturnType<typeof fetchAcademicSessions>>);
}

export async function renderReports() {
  renderWithProviders(
    <>
      <UserLoaded />
      <ReportsHome />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}
