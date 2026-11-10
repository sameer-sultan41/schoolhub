import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  examPage,
  examRecord,
  OTHER_EXAM_ID,
  SESSION_ID,
  TERM_ID,
} from "@/services/modules/exams/__tests__/exams-fixtures";
import { UserLoaded, USER_LOADED } from "@/test-fixtures/user-loaded";
import { Services } from "@/services";
import { buildUser, type createNavigationMock, renderWithProviders } from "@/test-utils";

import {
  asUser,
  deleteExam,
  fetchAcademicSessions,
  fetchExamsPage,
  lastArg,
  mocked,
  pick,
  stubExamsServices,
  urlParam,
} from "../../__tests__/exams-test-support";
import { ExamsHome } from "../exams-home";
import { ExamsTable } from "../exams-table";

/** The file's navigation mock, typed as built: its router methods are plain `jest.fn`s. */
function mockedRouter() {
  const navigation = jest.requireMock<ReturnType<typeof createNavigationMock>>("next/navigation");
  return navigation.useRouter();
}

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

const SCHEDULED_ID = "11b2c3d4-e5f6-4a07-8b18-c9d0e1f2a3b4";
const MARKS_ID = "22c3d4e5-f6a7-4b18-9c29-d0e1f2a3b4c5";

/** One exam per place in the lifecycle that decides what a row may do. */
function threeExams() {
  return examPage([
    examRecord({ name: "Draft exam" }),
    examRecord({ id: SCHEDULED_ID, name: "Scheduled exam", status: "scheduled" }),
    examRecord({ id: MARKS_ID, name: "Marks exam", status: "marks_entry" }),
  ]);
}

async function renderTable() {
  renderWithProviders(
    <>
      <UserLoaded />
      <ExamsTable />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}

describe("ExamsTable", () => {
  beforeEach(() => {
    stubExamsServices();
  });

  it("lists each exam with its session and term, type, dates, status and subject count", async () => {
    await renderTable();

    const row = (await screen.findByText("Term 1 Midterm")).closest("tr");
    if (!row) throw new Error("row not rendered");
    expect(within(row).getByText("2026-27, Term 1")).toBeInTheDocument();
    expect(within(row).getByText("Midterm")).toBeInTheDocument();
    expect(within(row).getByText("Draft")).toBeInTheDocument();
    expect(within(row).getByText("2")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "Term 1 Midterm" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/exams\/[0-9a-f-]{36}$/),
    );
  });

  it("starts unfiltered: no session, term, status or type is sent", async () => {
    await renderTable();

    await waitFor(() => {
      expect(fetchExamsPage).toHaveBeenCalled();
    });
    const query = lastArg(fetchExamsPage) as Record<string, unknown>;
    expect(query.academicSessionId).toBeUndefined();
    expect(query.termId).toBeUndefined();
    expect(query.status).toBeUndefined();
    expect(query.examType).toBeUndefined();
  });

  describe("the filters", () => {
    it("reads status and type from the URL into the query", async () => {
      stubExamsServices("/exams?status=scheduled&type=final");

      await renderTable();

      await waitFor(() => {
        expect(fetchExamsPage).toHaveBeenCalledWith(
          expect.objectContaining({ status: "scheduled", examType: "final" }),
        );
      });
    });

    it("writes a picked filter back to the URL and the query, and drops it for All", async () => {
      const user = await renderTable();

      await pick(user, "Status", "Marks entry");

      expect(urlParam("status")).toBe("marks_entry");
      await waitFor(() => {
        expect(lastArg(fetchExamsPage)).toEqual(expect.objectContaining({ status: "marks_entry" }));
      });

      await pick(user, "Status", "All statuses");

      expect(urlParam("status")).toBeNull();
    });

    it("round-trips a session and its term, and clears the term when the session changes", async () => {
      const user = await renderTable();

      await pick(user, "Academic session", "2026-27");
      expect(urlParam("session")).toBe(SESSION_ID);
      await screen.findByRole("combobox", { name: "Term" });
      await pick(user, "Term", "Term 1");
      expect(urlParam("term")).toBe(TERM_ID);
      await waitFor(() => {
        expect(lastArg(fetchExamsPage)).toEqual(
          expect.objectContaining({ academicSessionId: SESSION_ID, termId: TERM_ID }),
        );
      });

      await pick(user, "Academic session", "2027-28");

      expect(urlParam("term")).toBeNull();
    });

    it("offers no term until a session is picked", async () => {
      await renderTable();

      await screen.findByRole("combobox", { name: "Academic session" });
      expect(screen.queryByRole("combobox", { name: "Term" })).not.toBeInTheDocument();
    });

    it("sends the search text, trimmed", async () => {
      const user = await renderTable();

      await user.type(screen.getByRole("textbox", { name: "Search exams" }), " mid ");

      await waitFor(() => {
        expect(lastArg(fetchExamsPage)).toEqual(expect.objectContaining({ search: "mid" }));
      });
    });
  });

  describe("without a session read", () => {
    it("renders the exams, with no session picker, when the sessions fail to load", async () => {
      fetchAcademicSessions.mockRejectedValue(new Error("no academic-session key"));

      await renderTable();

      expect(await screen.findByText("Term 1 Midterm")).toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Academic session" })).not.toBeInTheDocument();
      expect(
        (lastArg(fetchExamsPage) as { academicSessionId?: string }).academicSessionId,
      ).toBeUndefined();
    });

    it("renders them, with no session picker, when the session list is empty", async () => {
      fetchAcademicSessions.mockResolvedValue([]);

      await renderTable();

      expect(await screen.findByText("Term 1 Midterm")).toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Academic session" })).not.toBeInTheDocument();
    });

    it("does not pin the list to a session in the URL it has no picker to clear", async () => {
      stubExamsServices(`/exams?session=${SESSION_ID}`);
      fetchAcademicSessions.mockResolvedValue([]);

      await renderTable();

      await waitFor(() => {
        expect(
          (lastArg(fetchExamsPage) as { academicSessionId?: string }).academicSessionId,
        ).toBeUndefined();
      });
    });
  });

  describe("row actions", () => {
    beforeEach(() => {
      fetchExamsPage.mockResolvedValue(threeExams());
    });

    it("offers Delete on a draft only, and Edit up to scheduled", async () => {
      asUser("exams.exam.update", "exams.exam.delete");
      await renderTable();

      await screen.findByText("Draft exam");
      expect(screen.getByRole("button", { name: "Delete Draft exam" })).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Delete Scheduled exam" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Delete Marks exam" })).not.toBeInTheDocument();

      expect(screen.getByRole("button", { name: "Edit Draft exam" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Edit Scheduled exam" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Edit Marks exam" })).not.toBeInTheDocument();
    });

    it("offers neither to a viewer holding only the view key", async () => {
      await renderTable();

      await screen.findByText("Draft exam");
      expect(screen.queryByRole("button", { name: /^(Edit|Delete) / })).not.toBeInTheDocument();
    });

    it("deletes a draft after a confirm", async () => {
      asUser("exams.exam.delete");
      deleteExam.mockResolvedValue(undefined);
      const user = await renderTable();

      await user.click(await screen.findByRole("button", { name: "Delete Draft exam" }));
      const dialog = await screen.findByRole("alertdialog");
      await user.click(within(dialog).getByRole("button", { name: "Delete exam" }));

      await waitFor(() => {
        expect(deleteExam).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f-]{36}$/));
      });
    });

    it("keeps the dialog open with the server's own sentence when the exam is no longer a draft", async () => {
      asUser("exams.exam.delete");
      const refusal = "This exam is scheduled. Only a draft exam can be deleted.";
      deleteExam.mockRejectedValue(
        new ApiError({
          code: "conflict",
          message: refusal,
          status: 409,
          url: `/exams/${OTHER_EXAM_ID}`,
          details: [],
        }),
      );
      const user = await renderTable();

      await user.click(await screen.findByRole("button", { name: "Delete Draft exam" }));
      const dialog = await screen.findByRole("alertdialog");
      await user.click(within(dialog).getByRole("button", { name: "Delete exam" }));

      expect(await within(dialog).findByText(refusal)).toBeInTheDocument();
    });
  });

  it("asks for a name and a session before sending a new exam", async () => {
    asUser("exams.exam.create");
    fetchAcademicSessions.mockResolvedValue([]);
    renderWithProviders(
      <>
        <UserLoaded />
        <ExamsHome />
      </>,
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "New exam" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findAllByText("This field is required.")).toHaveLength(2);
  });
});

describe("ExamsHome", () => {
  beforeEach(() => {
    stubExamsServices();
  });

  it("shows the list to a holder of the Exams key, and redirects them nowhere", async () => {
    renderWithProviders(<ExamsHome />);

    expect(await screen.findByText("Term 1 Midterm")).toBeInTheDocument();
    expect(mockedRouter().replace).not.toHaveBeenCalled();
  });

  it("sends a viewer without the Exams key to the first section they may open", async () => {
    mocked(Services.auth.fetchCurrentUser).mockResolvedValue(
      buildUser(["exams.grading-scale.view"]),
    );

    renderWithProviders(<ExamsHome />);

    await waitFor(() => {
      expect(mockedRouter().replace).toHaveBeenCalledWith("/exams/grading-scales");
    });
    expect(fetchExamsPage).not.toHaveBeenCalled();
  });
});
