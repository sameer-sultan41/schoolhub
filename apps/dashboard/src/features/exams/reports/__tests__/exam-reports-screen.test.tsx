import type { PermissionKey } from "@schoolhub/types";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import {
  FILE_ID,
  JOB_ID,
  resultRegisterRow,
} from "@/services/modules/exam-reports/__tests__/exam-reports-fixtures";
import {
  EXAM_ID,
  examPage,
  examRecord,
  OTHER_EXAM_ID,
} from "@/services/modules/exams/__tests__/exams-fixtures";
import { lastArg, mocked, pick, urlParam } from "@/test-fixtures/list-screen";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { ExamReportsScreen } from "../exam-reports-screen";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{ examReportsServicesMock: () => unknown }>("./exam-reports-services-mock")
    .examReportsServicesMock(),
);

const runReport = mocked(Services.examReports.runReport);
const exportReport = mocked(Services.examReports.exportReport);
const fetchExamsPage = mocked(Services.exams.fetchExamsPage);
const fetchJob = mocked(Services.jobs.fetchJob);
const fetchFileDownloadUrl = mocked(Services.jobs.fetchFileDownloadUrl);

const VIEW: PermissionKey = "exams.result.view";
const EXAM_VIEW: PermissionKey = "exams.exam.view";
const EXPORT: PermissionKey = "exams.result.export";
const REGISTER_LINK = `/exams/reports?kind=result-register&exam=${EXAM_ID}`;
const REGISTER_QUERY = { kind: "result-register", examId: EXAM_ID };

const runButton = () => screen.getByRole("button", { name: "Run report" });

/** Signs in with the Reports key and the exam key (the per-exam kinds' picker), plus `keys`. */
function asUser(...keys: PermissionKey[]) {
  mocked(Services.auth.fetchCurrentUser).mockResolvedValue(buildUser([VIEW, EXAM_VIEW, ...keys]));
}

async function renderReports(url = "/exams/reports") {
  setUrl(url);
  renderWithProviders(
    <>
      <UserLoaded />
      <ExamReportsScreen />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}

describe("Exam reports", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    asUser();
    fetchExamsPage.mockResolvedValue(
      examPage([
        examRecord(),
        examRecord({ id: OTHER_EXAM_ID, name: "Finals", academic_session_name: "2025-26" }),
      ]),
    );
    runReport.mockResolvedValue({ kind: "result-register", rows: [resultRegisterRow()] });
  });

  it("waits for an exam before a report about one can run", async () => {
    await renderReports();

    expect(screen.getByText("Pick a report and run it")).toBeInTheDocument();
    expect(runButton()).toBeDisabled();
    expect(runReport).not.toHaveBeenCalled();
    expect(fetchExamsPage).toHaveBeenCalledWith({ pageSize: 100, ordering: "-starts_on" });
  });

  it("runs the report on the exam picked, keeping both in the URL", async () => {
    const user = await renderReports();

    await pick(user, "Exam", "Finals · 2025-26");
    await user.click(runButton());

    expect(urlParam("kind")).toBe("result-register");
    expect(urlParam("exam")).toBe(OTHER_EXAM_ID);
    await waitFor(() => {
      expect(lastArg(runReport)).toEqual({ kind: "result-register", examId: OTHER_EXAM_ID });
    });
    expect(await screen.findByRole("table", { name: "Result register report" })).toBeVisible();
  });

  it("hides the exam picker for question-bank usage, which runs without one", async () => {
    runReport.mockResolvedValue({ kind: "question-bank-usage", rows: [] });
    const user = await renderReports();

    await pick(user, "Report", "Question-bank usage");

    expect(screen.queryByRole("combobox", { name: "Exam" })).not.toBeInTheDocument();
    await user.click(runButton());
    await waitFor(() => {
      expect(lastArg(runReport)).toEqual({ kind: "question-bank-usage" });
    });
  });

  it("offers only question-bank usage, and reads no exams, without exams.exam.view", async () => {
    mocked(Services.auth.fetchCurrentUser).mockResolvedValue(buildUser([VIEW]));
    runReport.mockResolvedValue({ kind: "question-bank-usage", rows: [] });
    const user = await renderReports(REGISTER_LINK);

    expect(screen.getByText(/^The per-exam reports need permission to view exams/)).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "Exam" })).not.toBeInTheDocument();
    // A link to a per-exam report is not one this viewer is offered: it does not run.
    expect(runReport).not.toHaveBeenCalled();
    await user.click(screen.getByRole("combobox", { name: "Report" }));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Question-bank usage",
    ]);
    await user.keyboard("{Escape}");

    await user.click(runButton());
    await waitFor(() => {
      expect(lastArg(runReport)).toEqual({ kind: "question-bank-usage" });
    });
    expect(fetchExamsPage).not.toHaveBeenCalled();
  });

  it("reads no exams while the kind needs none", async () => {
    runReport.mockResolvedValue({ kind: "question-bank-usage", rows: [] });
    await renderReports("/exams/reports?kind=question-bank-usage");

    expect(screen.queryByRole("combobox", { name: "Exam" })).not.toBeInTheDocument();
    expect(fetchExamsPage).not.toHaveBeenCalled();
  });

  it("runs the report a shared link names on arrival", async () => {
    await renderReports(REGISTER_LINK);

    await waitFor(() => {
      expect(lastArg(runReport)).toEqual(REGISTER_QUERY);
    });
    expect(await screen.findByText("1 row")).toBeInTheDocument();
  });

  it("does not run a link whose kind is not a report", async () => {
    await renderReports("/exams/reports?kind=not-a-report");

    expect(await screen.findByRole("button", { name: "Run report" })).toBeInTheDocument();
    expect(runReport).not.toHaveBeenCalled();
  });

  it("polls a report too large to show, then offers its file", async () => {
    runReport.mockResolvedValue({ jobId: JOB_ID });
    fetchJob.mockResolvedValue({
      id: JOB_ID,
      job_type: "exams.report-export",
      status: "succeeded",
      progress: 100,
      result: { result_file_id: FILE_ID, rows: 1500, format: "csv" },
      error: null,
    });
    fetchFileDownloadUrl.mockResolvedValue("https://storage.test/exam-report.csv");
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const user = await renderReports(REGISTER_LINK);

    expect(await screen.findByText("This report is being built as a file")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Download CSV" }));

    await waitFor(() => {
      expect(fetchFileDownloadUrl).toHaveBeenCalledWith(FILE_ID);
    });
    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalled();
    });
    clickSpy.mockRestore();
  });

  it("shows no export without exams.result.export", async () => {
    await renderReports(REGISTER_LINK);

    expect(await screen.findByRole("table", { name: "Result register report" })).toBeVisible();
    expect(screen.queryByRole("group", { name: "Export the report" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export CSV" })).not.toBeInTheDocument();
  });

  it("exports the report on screen with exams.result.export", async () => {
    asUser(EXPORT);
    exportReport.mockResolvedValue({ jobId: JOB_ID });
    fetchJob.mockResolvedValue({
      id: JOB_ID,
      job_type: "exams.report-export",
      status: "succeeded",
      progress: 100,
      result: { result_file_id: FILE_ID },
      error: null,
    });
    fetchFileDownloadUrl.mockResolvedValue("https://storage.test/exam-report.pdf");
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const user = await renderReports(REGISTER_LINK);

    await user.click(await screen.findByRole("button", { name: "Export PDF" }));

    await waitFor(() => {
      expect(exportReport).toHaveBeenCalledWith(REGISTER_QUERY, "pdf");
    });
    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalled();
    });
    clickSpy.mockRestore();
  });

  it("says when the form no longer matches the report on screen", async () => {
    const user = await renderReports(REGISTER_LINK);
    await screen.findByRole("table", { name: "Result register report" });

    await pick(user, "Report", "Grade distribution");

    expect(screen.getByText(/^The options changed\./)).toBeInTheDocument();
  });
});
