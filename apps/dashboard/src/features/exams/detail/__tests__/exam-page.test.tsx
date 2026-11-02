import { ApiError } from "@schoolhub/api-client";
import type { PermissionKey } from "@schoolhub/types";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { EXAM_ID, examRecord } from "@/services/modules/exams/__tests__/exams-fixtures";
import { EXAM_STATUSES } from "@/services/modules/exams/exams-constant";
import {
  EXAM_SUBJECT_ID,
  marksGrid,
  SECTION_ID,
} from "@/services/modules/marks/__tests__/marks-fixtures";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";

import {
  asUser,
  fetchAdmitCardsPage,
  fetchExam,
  fetchExamSubjects,
  fetchGrid,
  lastArg,
  mocked,
  stubExamsServices,
  updateExam,
  urlParam,
} from "../../__tests__/exams-test-support";
import { ExamPage } from "../exam-page";
import { ExamStatusStepper } from "../exam-status-stepper";
import { EXAM_TABS, ExamTabs } from "../exam-tabs";

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

const FROZEN = "This exam is marks entry and its configuration is frozen.";

async function renderPage() {
  renderWithProviders(
    <>
      <UserLoaded />
      <ExamPage examId={EXAM_ID} />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}

describe("ExamPage", () => {
  beforeEach(() => {
    stubExamsServices(`/exams/${EXAM_ID}`);
  });

  it("shows the exam's header, its stepper at the current status and the Subjects tab", async () => {
    await renderPage();

    expect(await screen.findByRole("heading", { name: "Term 1 Midterm" })).toBeInTheDocument();
    expect(screen.getByText("2026-27, Term 1")).toBeInTheDocument();
    expect(screen.getByText("Grading scale: Standard letters")).toBeInTheDocument();
    const current = within(screen.getByRole("list", { name: "Exam progress" }))
      .getAllByRole("listitem")
      .filter((item) => item.getAttribute("aria-current") === "step");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Draft");
    expect(await screen.findByRole("tab", { name: "Subjects" })).toBeInTheDocument();
  });

  it("says so, with a way back, for an exam that isn't there", async () => {
    fetchExam.mockRejectedValue(
      new ApiError({
        code: "not_found",
        message: "Not found.",
        status: 404,
        url: "/exams/x",
        details: [],
      }),
    );

    await renderPage();

    expect(await screen.findByText("Exam not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to exams" })).toHaveAttribute("href", "/exams");
  });

  describe("what the viewer may do to the exam", () => {
    it.each(["draft", "scheduled"] as const)("lets an updater edit a %s exam", async (status) => {
      asUser("exams.exam.update");
      fetchExam.mockResolvedValue(examRecord({ status }));

      await renderPage();

      expect(await screen.findByRole("button", { name: "Edit exam" })).toBeEnabled();
    });

    it.each(["ongoing", "marks_entry", "processing", "approved", "published", "archived"] as const)(
      "disables Edit on a %s exam, saying why",
      async (status) => {
        asUser("exams.exam.update");
        fetchExam.mockResolvedValue(examRecord({ status }));

        await renderPage();

        const edit = await screen.findByRole("button", { name: "Edit exam" });
        expect(edit).toBeDisabled();
        expect(edit.closest("span")).toHaveAttribute(
          "title",
          "This exam's configuration is frozen once it is past Scheduled.",
        );
      },
    );

    it("offers Delete on a draft only", async () => {
      asUser("exams.exam.delete");
      await renderPage();
      expect(await screen.findByRole("button", { name: "Delete exam" })).toBeInTheDocument();
    });

    it.each(EXAM_STATUSES.filter((status) => status !== "draft"))(
      "offers no Delete on a %s exam",
      async (status) => {
        asUser("exams.exam.delete");
        fetchExam.mockResolvedValue(examRecord({ status }));

        await renderPage();

        await screen.findByRole("heading", { name: "Term 1 Midterm" });
        expect(screen.queryByRole("button", { name: "Delete exam" })).not.toBeInTheDocument();
      },
    );

    it("offers neither to a viewer holding only the view key", async () => {
      await renderPage();

      await screen.findByRole("heading", { name: "Term 1 Midterm" });
      expect(
        screen.queryByRole("button", { name: /Edit exam|Delete exam/ }),
      ).not.toBeInTheDocument();
    });

    it("shows the server's own sentence and reloads the exam when an edit finds it has moved on", async () => {
      asUser("exams.exam.update");
      updateExam.mockRejectedValue(
        new ApiError({
          code: "conflict",
          message: FROZEN,
          status: 409,
          url: `/exams/${EXAM_ID}`,
          details: [],
        }),
      );
      const user = await renderPage();

      await user.click(await screen.findByRole("button", { name: "Edit exam" }));
      const dialog = await screen.findByRole("dialog");
      await waitFor(() => {
        expect(
          within(dialog).getByRole("combobox", { name: "Academic session" }),
        ).toHaveTextContent("2026-27");
      });
      const loads = fetchExam.mock.calls.length;
      await user.click(within(dialog).getByRole("button", { name: "Save" }));

      expect(await within(dialog).findByText(FROZEN)).toBeInTheDocument();
      expect(updateExam).toHaveBeenCalledWith(
        EXAM_ID,
        expect.objectContaining({ name: "Term 1 Midterm" }),
      );
      await waitFor(() => {
        expect(fetchExam.mock.calls.length).toBeGreaterThan(loads);
      });
    });
  });
});

describe("ExamTabs", () => {
  beforeEach(() => {
    stubExamsServices(`/exams/${EXAM_ID}`);
  });

  function renderTabs() {
    renderWithProviders(
      <>
        <UserLoaded />
        <ExamTabs exam={examRecord()} />
      </>,
    );
    return screen.findByText(USER_LOADED);
  }

  it("names every tab of the exam page, each on its own key", () => {
    expect(EXAM_TABS.map((tab) => [tab.id, tab.permission])).toEqual([
      ["subjects", "exams.exam.view"],
      ["schedule", "exams.schedule.view"],
      ["admit-cards", "exams.admit-card.view"],
      ["marks", "exams.marks.view"],
      ["results", "exams.result.view"],
      ["report-cards", "exams.report-card.view"],
    ]);
  });

  it("draws only the tabs that have content: Subjects, Schedule, Admit cards and Marks now, whatever other keys the viewer holds", async () => {
    asUser("exams.schedule.view", "exams.admit-card.view", "exams.marks.view", "exams.result.view");

    await renderTabs();

    expect(await screen.findAllByRole("tab")).toHaveLength(4);
    expect(screen.getByRole("tab", { name: "Subjects" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Schedule" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Admit cards" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Marks" })).toBeInTheDocument();
  });

  it("gates the Marks tab on the marks view key, not the entry key", async () => {
    asUser("exams.marks.create");

    await renderTabs();

    expect(await screen.findByRole("tab", { name: "Subjects" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Marks" })).not.toBeInTheDocument();
  });

  it("gates the Admit cards tab on the admit-card view key", async () => {
    asUser("exams.schedule.view");

    await renderTabs();

    expect(await screen.findByRole("tab", { name: "Schedule" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Admit cards" })).not.toBeInTheDocument();
  });

  it("gates the Schedule tab on the schedule view key", async () => {
    asUser();

    await renderTabs();

    expect(await screen.findByRole("tab", { name: "Subjects" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Schedule" })).not.toBeInTheDocument();
  });

  it("draws no tab for a viewer without the key of a tab that has content", async () => {
    mocked(Services.auth.fetchCurrentUser).mockResolvedValue(
      buildUser(["exams.result.view" satisfies PermissionKey]),
    );

    await renderTabs();

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(fetchExamSubjects).not.toHaveBeenCalled();
  });

  it("falls back to the first tab for a `tab` the viewer cannot see", async () => {
    setUrl(`/exams/${EXAM_ID}?tab=marks`);

    await renderTabs();

    expect(
      await screen.findByRole("tab", { name: "Subjects", selected: true }),
    ).toBeInTheDocument();
    expect(urlParam("tab")).toBe("marks");
  });

  it("drops the marks grid's subject and section when leaving the Marks tab", async () => {
    asUser("exams.marks.view", "exams.admit-card.view");
    fetchGrid.mockResolvedValue(marksGrid());
    setUrl(`/exams/${EXAM_ID}?tab=marks&subject=${EXAM_SUBJECT_ID}&section=${SECTION_ID}`);

    await renderTabs();
    const user = userEvent.setup();
    await screen.findByRole("textbox", { name: "Theory marks for Ali Raza" });

    await user.click(screen.getByRole("tab", { name: "Admit cards" }));

    expect(urlParam("tab")).toBe("admit-cards");
    expect(urlParam("subject")).toBeNull();
    expect(urlParam("section")).toBeNull();
    await waitFor(() => {
      expect(fetchAdmitCardsPage).toHaveBeenCalled();
    });
    expect(lastArg(fetchAdmitCardsPage)).toMatchObject({ sectionId: undefined });
  });

  it("keeps the first tab out of the URL", async () => {
    await renderTabs();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("tab", { name: "Subjects" }));

    expect(urlParam("tab")).toBeNull();
  });
});

const STATUS_LABEL: Record<(typeof EXAM_STATUSES)[number], string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  ongoing: "Ongoing",
  marks_entry: "Marks entry",
  processing: "Processing",
  approved: "Approved",
  published: "Published",
  archived: "Archived",
};

describe("ExamStatusStepper", () => {
  it.each(EXAM_STATUSES)("draws every status, with %s as the one current step", (status) => {
    renderWithProviders(<ExamStatusStepper status={status} />);

    const steps = within(screen.getByRole("list", { name: "Exam progress" })).getAllByRole(
      "listitem",
    );
    expect(steps).toHaveLength(EXAM_STATUSES.length);
    const current = steps.filter((step) => step.getAttribute("aria-current") === "step");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent(STATUS_LABEL[status]);
  });

  it("shows ongoing as skipped once the exam is past it, never as done", () => {
    renderWithProviders(<ExamStatusStepper status="marks_entry" />);

    const steps = within(screen.getByRole("list")).getAllByRole("listitem");
    const ongoing = steps.find((step) => step.textContent.startsWith("Ongoing"));
    const scheduled = steps.find((step) => step.textContent.startsWith("Scheduled"));
    expect(ongoing).toHaveTextContent("skipped");
    expect(scheduled).toHaveTextContent("done");
  });

  it("marks archived as the final status, and the last step as upcoming before it", () => {
    renderWithProviders(<ExamStatusStepper status="published" />);

    const steps = within(screen.getByRole("list")).getAllByRole("listitem");
    const archived = steps[steps.length - 1];
    expect(archived).toHaveTextContent("Archived");
    expect(archived).toHaveTextContent("upcoming, final status");
  });
});
