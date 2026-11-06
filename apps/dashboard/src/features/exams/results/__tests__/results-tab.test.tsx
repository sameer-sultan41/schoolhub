import { screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";

import { resultPage } from "@/services/modules/exam-results/__tests__/exam-results-fixtures";
import { sittingRecord } from "@/services/modules/exam-schedules/__tests__/exam-schedules-fixtures";
import { EXAM_ID } from "@/services/modules/exams/__tests__/exams-fixtures";
import {
  EXAM_SUBJECT_ID,
  marksRecord,
  OTHER_EXAM_SUBJECT_ID,
} from "@/services/modules/marks/__tests__/marks-fixtures";
import { subjectRecord } from "@/services/modules/exam-subjects/__tests__/exam-subjects-fixtures";

import {
  asUser,
  fetchExamSubjects,
  fetchResultsPage,
  fetchSittings,
  fetchStudentMarks,
  lastArg,
  pick,
  rowOf,
  stubExamsServices,
  urlParam,
  withholdResult,
} from "../../__tests__/exams-test-support";
import { apiError, PENDING, renderTab, RESULT_VIEW, WITHHELD } from "./results-test-support";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{ examsServicesMock: () => unknown }>("../../__tests__/exams-services-mock")
    .examsServicesMock(),
);

describe("ResultsTab: the list", () => {
  beforeEach(() => {
    stubExamsServices(`/exams/${EXAM_ID}?tab=results`);
    asUser(RESULT_VIEW);
    fetchResultsPage.mockResolvedValue(resultPage([PENDING, WITHHELD]));
  });

  it("lists each result with the server's rank, figures, outcome and status", async () => {
    await renderTab();

    await screen.findByText(PENDING.student_name);
    const row = rowOf(PENDING.student_name);
    expect(row.getByText("1")).toBeInTheDocument();
    expect(row.getByText("82.50%")).toBeInTheDocument();
    expect(row.getByText("3.70")).toBeInTheDocument();
    expect(row.getByText("Pass")).toBeInTheDocument();
    expect(row.getByText("Awaiting approval")).toBeInTheDocument();
    expect(rowOf(WITHHELD.student_name).getByText("Withheld")).toBeInTheDocument();
    expect(lastArg(fetchResultsPage)).toMatchObject({
      examId: EXAM_ID,
      ordering: "-percentage",
      sectionId: undefined,
      outcome: undefined,
      status: undefined,
    });
  });

  it("reads its section, outcome and status filters from the URL", async () => {
    stubExamsServices(
      `/exams/${EXAM_ID}?tab=results&section=${WITHHELD.section_id}&outcome=withheld&status=approved`,
    );
    asUser(RESULT_VIEW);
    fetchResultsPage.mockResolvedValue(resultPage([WITHHELD]));

    await renderTab();

    await waitFor(() => {
      expect(lastArg(fetchResultsPage)).toMatchObject({
        sectionId: WITHHELD.section_id,
        outcome: "withheld",
        status: "approved",
      });
    });
  });

  it("writes a picked outcome or status filter to the URL and re-reads with it", async () => {
    const user = await renderTab();
    await screen.findByText(PENDING.student_name);

    await pick(user, "Outcome", "Withheld");
    await pick(user, "Status", "Approved");

    expect(urlParam("outcome")).toBe("withheld");
    expect(urlParam("status")).toBe("approved");
    await waitFor(() => {
      expect(lastArg(fetchResultsPage)).toMatchObject({ outcome: "withheld", status: "approved" });
    });
  });

  it("offers no Withhold without the publish key", async () => {
    await renderTab();

    await screen.findByText(PENDING.student_name);
    expect(screen.queryByRole("button", { name: /Withhold/ })).not.toBeInTheDocument();
  });
});

describe("ResultsTab: the section filter", () => {
  beforeEach(() => {
    stubExamsServices(`/exams/${EXAM_ID}?tab=results`);
    fetchResultsPage.mockResolvedValue(resultPage([PENDING]));
    fetchSittings.mockResolvedValue([sittingRecord()]);
  });

  it("is hidden, and the sittings never read, for a viewer holding the tab's key alone", async () => {
    asUser(RESULT_VIEW);
    await renderTab();

    await screen.findByText(PENDING.student_name);
    expect(screen.queryByRole("combobox", { name: "Section" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Outcome" })).toBeInTheDocument();
    expect(fetchSittings).not.toHaveBeenCalled();
  });

  it("lists the exam's sections from its sittings for a holder of the schedule key", async () => {
    asUser(RESULT_VIEW, "exams.schedule.view");
    const user = await renderTab();
    await screen.findByText(PENDING.student_name);

    await pick(user, "Section", "Grade 5 A");

    expect(fetchSittings).toHaveBeenCalledWith(EXAM_ID);
    expect(urlParam("section")).toBe(sittingRecord().section_id);
  });
});

describe("ResultsTab: the detail sheet", () => {
  beforeEach(() => {
    stubExamsServices(`/exams/${EXAM_ID}?tab=results`);
    asUser(RESULT_VIEW, "exams.marks.view");
    fetchResultsPage.mockResolvedValue(resultPage([PENDING]));
    fetchExamSubjects.mockResolvedValue([
      subjectRecord(),
      subjectRecord({ id: OTHER_EXAM_SUBJECT_ID, subject_name: "Science", max_marks: "50.00" }),
    ]);
  });

  it("lists the student's subject marks from GET /marks, each named by its exam-subject", async () => {
    fetchStudentMarks.mockResolvedValue([
      marksRecord({ id: "m1", exam_subject_id: EXAM_SUBJECT_ID, theory_marks: "88.00" }),
      marksRecord({
        id: "m2",
        exam_subject_id: OTHER_EXAM_SUBJECT_ID,
        theory_marks: null,
        is_absent: true,
      }),
    ]);
    const user = await renderTab();

    await user.click(await screen.findByRole("button", { name: PENDING.student_name }));

    const sheet = await screen.findByRole("dialog", { name: "Ali Raza's result" });
    expect(await within(sheet).findByText("88.00 / 100.00")).toBeInTheDocument();
    expect(within(sheet).getByText("Mathematics")).toBeInTheDocument();
    expect(within(sheet).getByText("Science")).toBeInTheDocument();
    expect(within(sheet).getByText("Absent")).toBeInTheDocument();
    expect(within(sheet).getByText("Hina Clerk")).toBeInTheDocument();
    expect(fetchStudentMarks).toHaveBeenCalledWith(EXAM_ID, PENDING.student_id);
  });
});

describe("ResultsTab: the detail sheet without the marks view key", () => {
  beforeEach(() => {
    stubExamsServices(`/exams/${EXAM_ID}?tab=results`);
    asUser(RESULT_VIEW);
    fetchResultsPage.mockResolvedValue(resultPage([PENDING]));
  });

  it("says why the subject marks are absent and never asks GET /marks, which would refuse it", async () => {
    const user = await renderTab();

    await user.click(await screen.findByRole("button", { name: PENDING.student_name }));

    const sheet = await screen.findByRole("dialog", { name: "Ali Raza's result" });
    expect(
      within(sheet).getByText("Subject marks are shown to staff who can view marks."),
    ).toBeInTheDocument();
    expect(within(sheet).getByText("Hina Clerk")).toBeInTheDocument();
    expect(fetchStudentMarks).not.toHaveBeenCalled();
  });
});

describe("ResultsTab: Withhold", () => {
  beforeEach(() => {
    stubExamsServices(`/exams/${EXAM_ID}?tab=results`);
    asUser(RESULT_VIEW, "exams.result.publish");
    fetchResultsPage.mockResolvedValue(resultPage([PENDING, WITHHELD]));
  });

  it("is offered on a result not yet withheld or published, never on one already withheld", async () => {
    await renderTab();

    await screen.findByText(PENDING.student_name);
    expect(
      rowOf(PENDING.student_name).getByRole("button", { name: "Withhold Ali Raza's result" }),
    ).toBeInTheDocument();
    expect(rowOf(WITHHELD.student_name).queryByRole("button", { name: /Withhold/ })).toBeNull();
  });

  it("confirms with a reason, then reloads the list", async () => {
    withholdResult.mockResolvedValue({ ...PENDING, outcome: "withheld" });
    const user = await renderTab();
    await screen.findByText(PENDING.student_name);
    const reads = fetchResultsPage.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Withhold Ali Raza's result" }));
    const dialog = await screen.findByRole("dialog", { name: "Withhold Ali Raza's result" });
    await user.click(within(dialog).getByRole("button", { name: "Withhold result" }));
    expect(await within(dialog).findByText("Give a reason.")).toBeInTheDocument();
    expect(withholdResult).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText("Reason"), "Fees outstanding");
    await user.click(within(dialog).getByRole("button", { name: "Withhold result" }));

    await waitFor(() => {
      expect(withholdResult).toHaveBeenCalledWith(PENDING.id, "Fees outstanding");
    });
    expect(toast.success).toHaveBeenCalledWith("Ali Raza's result withheld.");
    await waitFor(() => {
      expect(fetchResultsPage.mock.calls.length).toBeGreaterThan(reads);
    });
  });

  it("keeps the server's sentence when the result was published meanwhile", async () => {
    const refusal =
      "This result is already published, so it cannot be withheld. Reprocess the exam to correct it.";
    withholdResult.mockRejectedValue(apiError(409, "conflict", refusal));
    const user = await renderTab();
    await screen.findByText(PENDING.student_name);

    await user.click(screen.getByRole("button", { name: "Withhold Ali Raza's result" }));
    const dialog = await screen.findByRole("dialog", { name: "Withhold Ali Raza's result" });
    await user.type(within(dialog).getByLabelText("Reason"), "Fees outstanding");
    await user.click(within(dialog).getByRole("button", { name: "Withhold result" }));

    expect(await within(dialog).findByText(refusal)).toBeInTheDocument();
  });
});
