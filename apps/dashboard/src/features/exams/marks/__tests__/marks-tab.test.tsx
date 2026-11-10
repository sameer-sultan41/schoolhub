import { screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";

import {
  EXAM_SUBJECT_ID,
  marksGrid,
  OTHER_EXAM_SUBJECT_ID,
  OTHER_SECTION_ID,
  progressRow,
  SECTION_ID,
} from "@/services/modules/marks/__tests__/marks-fixtures";
import { examRecord } from "@/services/modules/exams/__tests__/exams-fixtures";

import {
  asUser,
  fetchGrid,
  fetchProgress,
  lockMarks,
  rowOf,
  stubExamsServices,
  unlockMarks,
  urlParam,
} from "../../__tests__/exams-test-support";
import { asMarker, MARKS_LOCK, MARKS_VIEW, renderMarksTab } from "./marks-test-support";

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

/** English in Grade 5-B, locked: its own exam-subject and section, as the server lists it. */
const LOCKED_ROW = progressRow({
  exam_subject_id: OTHER_EXAM_SUBJECT_ID,
  subject_name: "English",
  section_id: OTHER_SECTION_ID,
  section_name: "B",
  is_locked: true,
  entered: 2,
  submitted: 2,
});

describe("MarksTab: progress", () => {
  beforeEach(() => {
    stubExamsServices();
    asMarker();
    fetchProgress.mockResolvedValue([progressRow()]);
    fetchGrid.mockResolvedValue(marksGrid());
  });

  it("lists each subject and section with its counts and state", async () => {
    await renderMarksTab();

    await screen.findByText("Mathematics");
    const row = rowOf("Mathematics");
    expect(row.getByText("Grade 5 – A")).toBeInTheDocument();
    expect(row.getByText("1 of 2")).toBeInTheDocument();
    expect(row.getByText("0 of 2")).toBeInTheDocument();
    expect(row.getByText("In progress")).toBeInTheDocument();
  });

  it("opens the section's grid from Enter marks, through the URL", async () => {
    const user = await renderMarksTab();

    await user.click(
      await screen.findByRole("button", { name: "Enter marks for Mathematics, Grade 5 – A" }),
    );

    expect(urlParam("subject")).toBe(EXAM_SUBJECT_ID);
    expect(urlParam("section")).toBe(SECTION_ID);
    expect(urlParam("tab")).toBe("marks");
    await screen.findByRole("heading", { name: "Mathematics · Grade 5 – A" });
    expect(fetchGrid).toHaveBeenCalledWith({
      examSubjectId: EXAM_SUBJECT_ID,
      sectionId: SECTION_ID,
    });

    await user.click(screen.getByRole("button", { name: "Back to progress" }));

    expect(urlParam("subject")).toBeNull();
    expect(urlParam("section")).toBeNull();
    expect(await screen.findByText("1 of 2")).toBeInTheDocument();
  });

  it("says when nothing is open to the viewer", async () => {
    fetchProgress.mockResolvedValue([]);

    await renderMarksTab();

    expect(await screen.findByText("No marks to enter")).toBeInTheDocument();
  });
});

describe("MarksTab: lock and unlock", () => {
  beforeEach(() => {
    stubExamsServices();
    fetchProgress.mockResolvedValue([progressRow(), LOCKED_ROW]);
  });

  it("hides Lock and Unlock without the lock key", async () => {
    asMarker();

    await renderMarksTab();

    await screen.findByText("English");
    expect(screen.queryByRole("button", { name: /^Lock / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Unlock / })).not.toBeInTheDocument();
  });

  it("locks the subject straight away", async () => {
    asUser(MARKS_VIEW, MARKS_LOCK);
    fetchProgress.mockResolvedValue([progressRow()]);
    lockMarks.mockResolvedValue({ locked_rows: 2, already_locked: false });

    const user = await renderMarksTab();
    await user.click(
      await screen.findByRole("button", { name: "Lock Mathematics marks for Grade 5" }),
    );

    await waitFor(() => {
      expect(lockMarks).toHaveBeenCalledWith(EXAM_SUBJECT_ID);
    });
    expect(toast.success).toHaveBeenCalledWith("Mathematics marks locked.");
  });

  it("confirms an unlock, saying it is audited, before sending it", async () => {
    asUser(MARKS_VIEW, MARKS_LOCK);
    fetchProgress.mockResolvedValue([LOCKED_ROW]);
    unlockMarks.mockResolvedValue({ unlocked_rows: 2, already_unlocked: false });

    const user = await renderMarksTab();
    await user.click(
      await screen.findByRole("button", { name: "Unlock English marks for Grade 5" }),
    );

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Unlocking is audited\./)).toBeInTheDocument();
    expect(unlockMarks).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Unlock marks" }));

    await waitFor(() => {
      expect(unlockMarks).toHaveBeenCalledWith(OTHER_EXAM_SUBJECT_ID);
    });
    expect(toast.success).toHaveBeenCalledWith("English marks unlocked.");
  });
});

describe("MarksTab: a locked subject during marks entry", () => {
  beforeEach(() => {
    stubExamsServices();
    fetchProgress.mockResolvedValue([LOCKED_ROW]);
  });

  it("tells a lock holder to unlock a locked subject before correcting it", async () => {
    asUser(MARKS_VIEW, MARKS_LOCK);

    await renderMarksTab();

    expect(await screen.findByText(/unlock it first; unlocking is audited/)).toBeInTheDocument();
  });

  it("tells anyone else to ask for the unlock", async () => {
    asMarker();

    await renderMarksTab();

    expect(await screen.findByText(/ask someone who can lock marks/)).toBeInTheDocument();
  });

  it("says nothing once the exam has moved past marks entry", async () => {
    asUser(MARKS_VIEW, MARKS_LOCK);

    await renderMarksTab(undefined, examRecord({ status: "processing" }));

    await screen.findByText("English");
    expect(screen.queryByText(/unlock it first/)).not.toBeInTheDocument();
  });
});
