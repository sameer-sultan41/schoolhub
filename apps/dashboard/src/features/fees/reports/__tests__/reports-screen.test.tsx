import type * as ReactModule from "react";
import { screen, waitFor } from "@testing-library/react";

import { ApiError } from "@schoolhub/api-client";
import { todayIsoDate } from "@/lib/helpers";
import {
  COLLECTION_DAY,
  LEDGER_INVOICE,
  STUDENT_ID,
} from "@/services/modules/finance-reports/__tests__/finance-reports-fixtures";

import {
  asUser,
  CAMPUS_ID,
  CLASS_ID,
  EXPORT,
  exportReport,
  FILE_ID,
  fetchAcademicSessions,
  fetchCampuses,
  fetchClasses,
  fetchFileDownloadUrl,
  fetchJob,
  fetchReport,
  JOB_ID,
  pick,
  REFERENCE_READS,
  renderReports,
  reportJob,
  SESSION_ID,
  stubReportsServices,
  tooLarge,
  urlParam,
} from "./reports-test-support";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{ reportsServicesMock: () => unknown }>("./reports-services-mock")
    .reportsServicesMock(),
);

// The picker searches the students list; a stand-in that picks one student keeps this file on the reports.
jest.mock("@/components/student-picker", () => {
  const react = jest.requireActual<typeof ReactModule>("react");
  return {
    StudentPicker: ({ onChange }: { onChange: (value: { id: string; name: string }) => void }) =>
      react.createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            onChange({ id: "11111111-1111-4111-8111-111111111111", name: "Aisha Khan" });
          },
        },
        "Choose a student",
      ),
  };
});

const TODAY = todayIsoDate();

describe("Reports screen", () => {
  beforeEach(() => {
    stubReportsServices();
  });

  it("opens on today's collection (§8's collection dashboard)", async () => {
    fetchReport.mockResolvedValue({ kind: "collection", rows: [COLLECTION_DAY] });
    await renderReports();

    expect(await screen.findByRole("table", { name: "Collection report" })).toBeInTheDocument();
    expect(fetchReport).toHaveBeenCalledWith({
      kind: "collection",
      dateFrom: TODAY,
      dateTo: TODAY,
      groupBy: "day",
    });
    expect(screen.getByText("1,500.00")).toBeInTheDocument();
  });

  it("groups the collection by cashier for §6's register, and keeps it in the URL", async () => {
    const user = await renderReports();

    await pick(user, "Group by", "Cashier");

    expect(urlParam("group")).toBe("cashier");
    await waitFor(() => {
      expect(fetchReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: "collection", groupBy: "cashier" }),
      );
    });
  });

  it("switches the report and writes it to the URL", async () => {
    const user = await renderReports();

    await pick(user, "Report", "Grants and waivers");

    expect(urlParam("kind")).toBe("grant-register");
    await waitFor(() => {
      expect(fetchReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: "grant-register", groupBy: undefined }),
      );
    });
  });

  describe("filters", () => {
    beforeEach(() => {
      asUser(...REFERENCE_READS);
    });

    it("writes the campus, session and class a collection is narrowed to, and sends them", async () => {
      const user = await renderReports();

      await pick(user, "Campus", "North campus");
      await pick(user, "Session", "2026-27");
      await pick(user, "Class", "Grade 5");

      expect(urlParam("campus")).toBe(CAMPUS_ID);
      expect(urlParam("session")).toBe(SESSION_ID);
      expect(urlParam("class")).toBe(CLASS_ID);
      await waitFor(() => {
        expect(fetchReport).toHaveBeenLastCalledWith(
          expect.objectContaining({
            kind: "collection",
            campusId: CAMPUS_ID,
            academicSessionId: SESSION_ID,
            classId: CLASS_ID,
          }),
        );
      });
    });

    it.each([
      ["collection", ["Campus", "Session", "Class"]],
      ["outstanding-aging", ["Campus", "Session", "Class"]],
      ["student-ledger", ["Session"]],
      ["grant-register", ["Campus", "Session", "Class"]],
      ["income-vs-expense", []],
      ["budget-variance", []],
      ["expense-register", ["Campus"]],
      ["trial-balance", []],
    ])("offers %s exactly the filters the server accepts", async (kind, offered) => {
      stubReportsServices(`/fees/reports?kind=${kind}&student=${STUDENT_ID}`);
      asUser(...REFERENCE_READS);
      await renderReports();

      for (const filter of ["Campus", "Session", "Class"]) {
        if (offered.includes(filter)) {
          expect(screen.getByRole("combobox", { name: filter })).toBeInTheDocument();
        } else {
          expect(screen.queryByRole("combobox", { name: filter })).not.toBeInTheDocument();
        }
      }
    });

    it("sends only the filters the report takes, even if the URL names more", async () => {
      stubReportsServices(
        `/fees/reports?kind=expense-register&campus=${CAMPUS_ID}&session=${SESSION_ID}&class=${CLASS_ID}`,
      );
      asUser(...REFERENCE_READS);
      await renderReports();

      await waitFor(() => {
        expect(fetchReport).toHaveBeenCalled();
      });
      const query = fetchReport.mock.calls[0]?.[0];
      expect(query).toMatchObject({ kind: "expense-register", campusId: CAMPUS_ID });
      expect(query?.academicSessionId).toBeUndefined();
      expect(query?.classId).toBeUndefined();
    });

    it("writes a range's dates, and one as-of date for the aging", async () => {
      stubReportsServices("/fees/reports?kind=outstanding-aging");
      asUser(...REFERENCE_READS);
      await renderReports();

      expect(screen.getByLabelText("As of")).toHaveValue(TODAY);
      expect(screen.queryByLabelText("From")).not.toBeInTheDocument();
    });
  });

  describe("reads behind other keys", () => {
    it("does not read a reference list, or offer its picker, without that list's own key (L55)", async () => {
      asUser("school.campus.view");
      await renderReports();

      expect(await screen.findByRole("combobox", { name: "Campus" })).toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Session" })).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Class" })).not.toBeInTheDocument();
      expect(fetchCampuses).toHaveBeenCalled();
      expect(fetchAcademicSessions).not.toHaveBeenCalled();
      expect(fetchClasses).not.toHaveBeenCalled();
    });
  });

  describe("a statement", () => {
    it("asks for a student before it can run", async () => {
      stubReportsServices("/fees/reports?kind=student-ledger");
      asUser("students.student.view");
      await renderReports();

      expect(await screen.findByText("Choose a student", { selector: "p" })).toBeInTheDocument();
      expect(fetchReport).not.toHaveBeenCalled();
    });

    it("runs for the picked student and writes the id to the URL", async () => {
      stubReportsServices("/fees/reports?kind=student-ledger");
      asUser("students.student.view");
      fetchReport.mockResolvedValue({ kind: "student-ledger", rows: [LEDGER_INVOICE] });
      const user = await renderReports();

      await user.click(screen.getByRole("button", { name: "Choose a student" }));

      expect(urlParam("student")).toBe(STUDENT_ID);
      expect(await screen.findByText("INV-0001")).toBeInTheDocument();
      expect(fetchReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: "student-ledger", studentId: STUDENT_ID }),
      );
    });

    it("says what is missing for a viewer who cannot read students", async () => {
      stubReportsServices("/fees/reports?kind=student-ledger");
      await renderReports();

      expect(await screen.findByText(/also needs permission to read students/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Choose a student" })).not.toBeInTheDocument();
    });
  });

  describe("a report too large to show", () => {
    it("offers to export it instead of showing an error", async () => {
      asUser(EXPORT);
      fetchReport.mockRejectedValue(tooLarge(1000));
      await renderReports();

      expect(await screen.findByText("Too large to show — export instead")).toBeInTheDocument();
      expect(screen.getByText(/more than 1000 rows/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Export CSV" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Export XLSX" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Export PDF" })).toBeInTheDocument();
      expect(screen.queryByText("The report could not be run.")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    });

    it("says to narrow the report for a viewer who cannot export, with no buttons", async () => {
      fetchReport.mockRejectedValue(tooLarge(1000));
      await renderReports();

      expect(await screen.findByText("Too large to show — export instead")).toBeInTheDocument();
      expect(screen.getByText(/Narrow the dates or filters/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Export/ })).not.toBeInTheDocument();
    });

    it("exports it: POSTs the report, polls the job, then downloads the file", async () => {
      asUser(EXPORT);
      fetchReport.mockRejectedValue(tooLarge(1000));
      exportReport.mockResolvedValue({ jobId: JOB_ID });
      fetchJob.mockResolvedValue(reportJob("succeeded"));
      fetchFileDownloadUrl.mockResolvedValue("https://storage.test/fees-collection.xlsx");
      const clickSpy = jest
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});
      const user = await renderReports();

      const exportXlsx = await screen.findByRole("button", { name: "Export XLSX" });
      await waitFor(() => {
        expect(exportXlsx).toBeEnabled();
      });
      await user.click(exportXlsx);

      await waitFor(() => {
        expect(exportReport).toHaveBeenCalledWith(
          { kind: "collection", dateFrom: TODAY, dateTo: TODAY, groupBy: "day" },
          "xlsx",
        );
      });
      await waitFor(() => {
        expect(fetchJob).toHaveBeenCalledWith(JOB_ID);
      });
      await waitFor(() => {
        expect(fetchFileDownloadUrl).toHaveBeenCalledWith(FILE_ID);
      });
      await waitFor(() => {
        expect(clickSpy).toHaveBeenCalled();
      });
      clickSpy.mockRestore();
    });
  });

  describe("export of a report on screen", () => {
    it("is offered, in each format, to a holder of fees.report.export", async () => {
      asUser(EXPORT);
      fetchReport.mockResolvedValue({ kind: "collection", rows: [COLLECTION_DAY] });
      await renderReports();

      expect(await screen.findByRole("table", { name: "Collection report" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Export CSV" })).toBeInTheDocument();
    });

    it("is hidden from a viewer without it", async () => {
      fetchReport.mockResolvedValue({ kind: "collection", rows: [COLLECTION_DAY] });
      await renderReports();

      expect(await screen.findByRole("table", { name: "Collection report" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Export/ })).not.toBeInTheDocument();
    });
  });

  it("shows any other failure as an error with Retry", async () => {
    fetchReport.mockRejectedValueOnce(
      new ApiError({
        status: 400,
        code: "validation_error",
        message: "Bad filter",
        url: "/reports/finance-summary",
        details: [{ field: "campus_id", issue: "This report cannot be filtered this way." }],
      }),
    );
    fetchReport.mockResolvedValue({ kind: "collection", rows: [COLLECTION_DAY] });
    const user = await renderReports();

    expect(await screen.findByText("This report cannot be filtered this way.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("table", { name: "Collection report" })).toBeInTheDocument();
  });
});
