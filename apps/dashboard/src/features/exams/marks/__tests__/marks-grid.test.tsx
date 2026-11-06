import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";

import type { MarksUnwritableReason } from "@/services";
import {
  ABOVE_MAX_ISSUE,
  EXAM_SUBJECT_ID,
  gridEntry,
  gridMeta,
  marksGrid,
  marksRecord,
  OTHER_STUDENT_ID,
  progressRow,
  refusedBulkEntry,
  SARA,
  SECTION_ID,
  STUDENT_ID,
  UNWRITABLE_MESSAGES,
  unwritableMeta,
} from "@/services/modules/marks/__tests__/marks-fixtures";

import {
  asUser,
  bulkEntry,
  fetchGrid,
  fetchProgress,
  lastArg,
  rowOf,
  stubExamsServices,
} from "../../__tests__/exams-test-support";
import { asMarker, gridUrl, MARKS_IMPORT, MARKS_VIEW, renderMarksTab } from "./marks-test-support";

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

const SAVED = { entered: 1, updated: 1, rows: 2 };
/** Sara with a saved 50, so every row holds a mark and Submit is open. */
const SARA_WITH_MARK = {
  ...SARA,
  marks: marksRecord({
    id: "d4e5f6a7-b8c9-4d3a-9e4b-5c6d7e8f9012",
    student_id: OTHER_STUDENT_ID,
    theory_marks: "50.00",
  }),
};
/** The server refusing Ali's theory mark as above the maximum. */
function aliAboveMax() {
  return refusedBulkEntry(
    [{ index: 0, student_id: STUDENT_ID, field: "theory_marks", issue: ABOVE_MAX_ISSUE }],
    2,
  );
}

/** The key the latest `:bulk-entry` was sent under. */
function lastKey(): unknown {
  return bulkEntry.mock.calls[bulkEntry.mock.calls.length - 1]?.[1];
}

async function openGrid() {
  const user = await renderMarksTab(gridUrl());
  await screen.findByRole("textbox", { name: "Theory marks for Ali Raza" });
  return user;
}

describe("Marks grid: entry", () => {
  beforeEach(() => {
    stubExamsServices();
    asMarker();
    fetchProgress.mockResolvedValue([progressRow()]);
    fetchGrid.mockResolvedValue(marksGrid());
    bulkEntry.mockResolvedValue(SAVED);
  });

  it("shows roll, name and admission number, then theory, absent, exempt and remarks", async () => {
    await openGrid();

    expect(screen.getByRole("columnheader", { name: "Theory (out of 100)" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /Practical/ })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Theory marks for Ali Raza" })).toHaveValue("45.5");
    expect(screen.getByText("ADM-002")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Sara Khan was absent" })).not.toBeChecked();
  });

  it("adds the practical column when the subject has one", async () => {
    fetchGrid.mockResolvedValue(
      marksGrid(
        undefined,
        gridMeta({
          examSubject: {
            maxMarks: "75.00",
            passMarks: "30.00",
            hasPractical: true,
            practicalMaxMarks: "25.00",
          },
        }),
      ),
    );

    await openGrid();

    expect(screen.getByRole("columnheader", { name: "Practical (out of 25)" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Practical marks for Sara Khan" })).toBeEnabled();
  });

  it("clears and disables the marks when a student is marked absent", async () => {
    const user = await openGrid();
    const theory = screen.getByRole("textbox", { name: "Theory marks for Ali Raza" });

    await user.click(screen.getByRole("checkbox", { name: "Ali Raza was absent" }));

    expect(theory).toHaveValue("");
    expect(theory).toBeDisabled();
  });

  it("hints when a mark is above the maximum, or not a mark", async () => {
    const user = await openGrid();
    const theory = screen.getByRole("textbox", { name: "Theory marks for Sara Khan" });

    await user.type(theory, "120");
    expect(screen.getByText("Above the maximum of 100.")).toBeInTheDocument();
    expect(theory).toHaveAttribute("aria-invalid", "true");

    await user.clear(theory);
    await user.type(theory, "12.345");
    expect(screen.getByText("Enter a number with at most two decimals.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
  });

  it("holds Submit while a student has nothing entered", async () => {
    await openGrid();

    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
    expect(screen.getByText(/1 student has no mark yet/)).toBeInTheDocument();
  });

  it("submits every row as submitted, with the section", async () => {
    const user = await openGrid();
    await user.type(screen.getByRole("textbox", { name: "Theory marks for Sara Khan" }), "62");
    await user.type(screen.getByRole("textbox", { name: "Remarks for Sara Khan" }), " Neat ");

    await user.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(bulkEntry).toHaveBeenCalledTimes(1);
    });
    expect(lastArg(bulkEntry)).toEqual({
      examSubjectId: EXAM_SUBJECT_ID,
      sectionId: SECTION_ID,
      entries: [
        {
          studentId: STUDENT_ID,
          theoryMarks: "45.5",
          practicalMarks: null,
          isAbsent: false,
          isExempt: false,
          status: "submitted",
          remarks: null,
        },
        {
          studentId: OTHER_STUDENT_ID,
          theoryMarks: "62",
          practicalMarks: null,
          isAbsent: false,
          isExempt: false,
          status: "submitted",
          remarks: "Neat",
        },
      ],
    });
    expect(toast.success).toHaveBeenCalledWith("Marks submitted: 1 entered, 1 updated.");
  });

  it("saves a draft of the rows that hold something, as draft", async () => {
    const user = await openGrid();

    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => {
      expect(bulkEntry).toHaveBeenCalledTimes(1);
    });
    expect(lastArg(bulkEntry)).toMatchObject({
      sectionId: SECTION_ID,
      entries: [{ studentId: STUDENT_ID, status: "draft" }],
    });
  });

  it("re-sends a saved row the teacher cleared, cleared, in a draft", async () => {
    const user = await openGrid();
    await user.clear(screen.getByRole("textbox", { name: "Theory marks for Ali Raza" }));

    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => {
      expect(bulkEntry).toHaveBeenCalledTimes(1);
    });
    expect(lastArg(bulkEntry)).toEqual({
      examSubjectId: EXAM_SUBJECT_ID,
      sectionId: SECTION_ID,
      entries: [
        {
          studentId: STUDENT_ID,
          theoryMarks: null,
          practicalMarks: null,
          isAbsent: false,
          isExempt: false,
          status: "draft",
          remarks: null,
        },
      ],
    });
  });
});

describe("Marks grid: a refused submission (Review Focus 3)", () => {
  beforeEach(() => {
    stubExamsServices();
    asMarker();
    fetchProgress.mockResolvedValue([progressRow()]);
    fetchGrid.mockResolvedValue(marksGrid([gridEntry(), SARA_WITH_MARK]));
  });

  it("marks the refused cell with the server's sentence and keeps every entry", async () => {
    bulkEntry.mockRejectedValue(aliAboveMax());
    const user = await openGrid();
    const ali = screen.getByRole("textbox", { name: "Theory marks for Ali Raza" });
    const sara = screen.getByRole("textbox", { name: "Theory marks for Sara Khan" });
    await user.clear(ali);
    await user.type(ali, "99");
    await user.clear(sara);
    await user.type(sara, "71");

    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(
      await screen.findByText("1 of 2 rows were rejected; nothing was saved."),
    ).toBeInTheDocument();
    expect(screen.getByText(ABOVE_MAX_ISSUE)).toBeInTheDocument();
    expect(ali).toHaveAttribute("aria-invalid", "true");
    expect(ali).toHaveAccessibleDescription(ABOVE_MAX_ISSUE);
    expect(sara).toHaveAttribute("aria-invalid", "false");
    expect(ali).toHaveValue("99");
    expect(sara).toHaveValue("71");
  });

  it("re-sends an unchanged grid under its key, and an edited one under a new key", async () => {
    bulkEntry
      .mockRejectedValueOnce(aliAboveMax())
      .mockRejectedValueOnce(aliAboveMax())
      .mockResolvedValue(SAVED);
    const user = await openGrid();
    const submit = screen.getByRole("button", { name: "Submit" });

    await user.click(submit);
    await screen.findByText("1 of 2 rows were rejected; nothing was saved.");
    const refusedKey = lastKey();
    await waitFor(() => {
      expect(submit).toBeEnabled();
    });

    await user.click(submit);
    await waitFor(() => {
      expect(bulkEntry).toHaveBeenCalledTimes(2);
    });
    expect(lastKey()).toBe(refusedKey);
    await waitFor(() => {
      expect(submit).toBeEnabled();
    });

    await user.type(screen.getByRole("textbox", { name: "Remarks for Ali Raza" }), "x");
    await user.click(submit);
    await waitFor(() => {
      expect(bulkEntry).toHaveBeenCalledTimes(3);
    });
    expect(lastKey()).not.toBe(refusedKey);
  });

  it("makes a new key after a success", async () => {
    const user = await openGrid();
    const submit = screen.getByRole("button", { name: "Submit" });

    await user.click(submit);
    await waitFor(() => {
      expect(bulkEntry).toHaveBeenCalledTimes(1);
    });
    const firstKey = lastKey();

    await waitFor(() => {
      expect(submit).toBeEnabled();
    });
    await user.click(submit);
    await waitFor(() => {
      expect(bulkEntry).toHaveBeenCalledTimes(2);
    });
    expect(lastKey()).not.toBe(firstKey);
  });

  it("reloads a grid the server stopped taking marks for, showing only saved marks", async () => {
    bulkEntry.mockRejectedValue(
      new ApiError({
        code: "conflict",
        message: UNWRITABLE_MESSAGES.window_closed,
        status: 409,
        url: "/marks:bulk-entry",
        details: [{ field: "non_field", issue: UNWRITABLE_MESSAGES.window_closed }],
      }),
    );
    const user = await openGrid();
    const sara = screen.getByRole("textbox", { name: "Theory marks for Sara Khan" });
    await user.clear(sara);
    await user.type(sara, "71");
    fetchGrid.mockResolvedValue(
      marksGrid([gridEntry(), SARA_WITH_MARK], unwritableMeta("window_closed")),
    );

    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(await screen.findAllByText(UNWRITABLE_MESSAGES.window_closed)).not.toHaveLength(0);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Submit" })).not.toBeInTheDocument();
    });
    // The refused 71 was never saved: the read-only row shows the server's 50.
    expect(rowOf("Sara Khan").getByText("50")).toBeInTheDocument();
    expect(screen.queryByText("71")).not.toBeInTheDocument();
  });
});

describe("Marks grid: read-only", () => {
  beforeEach(() => {
    stubExamsServices();
    asMarker();
    fetchProgress.mockResolvedValue([progressRow()]);
  });

  it.each<MarksUnwritableReason>([
    "exam_status",
    "window_not_open",
    "window_closed",
    "locked",
    "no_permission",
  ])("shows %s read-only, with the server's sentence", async (reason) => {
    fetchGrid.mockResolvedValue(marksGrid(undefined, unwritableMeta(reason)));

    await renderMarksTab(gridUrl());

    expect(await screen.findByText(UNWRITABLE_MESSAGES[reason])).toBeInTheDocument();
    expect(screen.getByText("45.5")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save draft" })).not.toBeInTheDocument();
  });

  it("says a section the viewer may not enter isn't open to them", async () => {
    fetchGrid.mockRejectedValue(
      new ApiError({ code: "not_found", message: "Not found.", status: 404, url: "/marks/grid" }),
    );

    await renderMarksTab(gridUrl());

    expect(await screen.findByText("This section isn't open to you")).toBeInTheDocument();
  });
});

describe("Marks grid: import", () => {
  beforeEach(() => {
    stubExamsServices();
    fetchProgress.mockResolvedValue([progressRow()]);
    fetchGrid.mockResolvedValue(marksGrid());
  });

  it("offers Import marks to a holder of the import key", async () => {
    asUser(MARKS_VIEW, MARKS_IMPORT);

    await renderMarksTab(gridUrl());

    expect(await screen.findByRole("button", { name: "Import marks" })).toBeInTheDocument();
  });

  it("offers no import without the key", async () => {
    asMarker();
    await renderMarksTab(gridUrl());
    await screen.findByRole("textbox", { name: "Theory marks for Ali Raza" });
    expect(screen.queryByRole("button", { name: "Import marks" })).not.toBeInTheDocument();
  });
});
