import { ApiError } from "@schoolhub/api-client";
import type { AuthenticatedUser, PermissionKey } from "@schoolhub/types";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import {
  CAMPUS_ID,
  CLASS_ID,
  CLOSED_SESSION,
  CLOSED_SESSION_ID,
  curriculumPage,
  curriculumRecord,
  PLANNED_SESSION,
  PLANNED_SESSION_ID,
  SESSION_ID,
  SESSIONS,
  UNKNOWN_SESSION_ID,
} from "@/services/modules/curriculum/__tests__/curriculum-fixtures";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { CurriculumTable } from "../curriculum-table";
import { CurriculumToolbar } from "../curriculum-toolbar";

// The list's view state lives in the URL; this keeps one in memory.
jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

// Saving and removing surface as toasts, and `renderWithProviders` mounts no `<Toaster/>`.
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

// The toolbar and the table render the add, edit, remove and clone dialogs, and each fires its
// own queries the instant it opens: every Service they call needs a default, or a test crashes
// with "not a function" the moment a dialog opens.
jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    auth: { fetchCurrentUser: jest.fn() },
    curriculum: {
      fetchCurriculumPage: jest.fn(),
      createCurriculum: jest.fn(),
      updateCurriculum: jest.fn(),
      deleteCurriculum: jest.fn(),
      cloneCurriculum: jest.fn(),
    },
    dashboard: { fetchCampuses: jest.fn() },
    schoolOrganization: {
      fetchClasses: jest.fn(),
      fetchSubjects: jest.fn(),
      fetchAcademicSessions: jest.fn(),
    },
  },
}));

const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;
const mockFetchCurriculumPage = Services.curriculum.fetchCurriculumPage as jest.MockedFunction<
  typeof Services.curriculum.fetchCurriculumPage
>;
const mockFetchCampuses = Services.dashboard.fetchCampuses as jest.MockedFunction<
  typeof Services.dashboard.fetchCampuses
>;
const mockFetchClasses = Services.schoolOrganization.fetchClasses as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchClasses
>;
const mockFetchSubjects = Services.schoolOrganization.fetchSubjects as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchSubjects
>;
const mockFetchAcademicSessions = Services.schoolOrganization
  .fetchAcademicSessions as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchAcademicSessions
>;

/** What the list requests with nothing in the URL: the current session, sorted by class. */
const DEFAULT_REQUEST = {
  page: 1,
  pageSize: 10,
  search: undefined,
  ordering: "class_name",
  academicSessionId: SESSION_ID,
  classId: undefined,
  campusId: undefined,
  isElective: undefined,
};

/** A viewer of the screen, plus whatever else a test grants. */
function userWith(...permissions: PermissionKey[]): AuthenticatedUser {
  return buildUser(["academics.curriculum.view", ...permissions]);
}

const FULL_ACCESS = userWith(
  "academics.curriculum.create",
  "academics.curriculum.update",
  "academics.curriculum.delete",
);

/** What DRF's page-number pagination answers for a page past the end. */
function pageNotFound() {
  return new ApiError({
    code: "not_found",
    message: "Invalid page.",
    status: 404,
    url: "/class-subjects",
  });
}

/** The address bar's current query, as key/value pairs. */
function urlParams() {
  return Object.fromEntries(new URLSearchParams(window.location.search));
}

/** The screen as the page composes it: the toolbar above the table. */
function renderScreen() {
  return renderWithProviders(
    <>
      <CurriculumToolbar />
      <CurriculumTable />
    </>,
  );
}

describe("CurriculumTable", () => {
  beforeEach(() => {
    setUrl("/academics/curriculum");
    mockFetchCurrentUser.mockReset().mockResolvedValue(FULL_ACCESS);
    mockFetchAcademicSessions.mockReset().mockResolvedValue(SESSIONS);
    mockFetchCurriculumPage.mockReset().mockResolvedValue(curriculumPage([curriculumRecord()]));
    mockFetchClasses.mockReset().mockResolvedValue([{ id: CLASS_ID, name: "Grade 1" }]);
    mockFetchSubjects.mockReset().mockResolvedValue([]);
    mockFetchCampuses.mockReset().mockResolvedValue([{ id: CAMPUS_ID, name: "Main Campus" }]);
  });

  describe("rows", () => {
    it("shows each mapping's class, subject, campus, kind and periods", async () => {
      mockFetchCurriculumPage.mockResolvedValue(
        curriculumPage([
          curriculumRecord(),
          curriculumRecord({
            id: "8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e1f",
            subject_name: "French",
            campus_id: null,
            campus_name: null,
            is_elective: true,
            elective_group: "Languages",
            weekly_periods: 3,
          }),
        ]),
      );

      renderScreen();

      expect(await screen.findByText("Mathematics")).toBeInTheDocument();
      expect(screen.getByText("Main Campus")).toBeInTheDocument();
      expect(screen.getByText("Core")).toBeInTheDocument();
      expect(screen.getByText("French")).toBeInTheDocument();
      expect(screen.getByText("All campuses")).toBeInTheDocument();
      expect(screen.getByText("Elective · Languages")).toBeInTheDocument();
    });

    it("says nothing is mapped yet when there are no rows and no filter", async () => {
      mockFetchCurriculumPage.mockResolvedValue(curriculumPage([]));

      renderScreen();

      expect(await screen.findByText("No subjects mapped yet")).toBeInTheDocument();
    });

    it("says no subjects match once a filter is applied", async () => {
      mockFetchCurriculumPage.mockResolvedValue(curriculumPage([]));
      setUrl("/academics/curriculum?kind=core");

      renderScreen();

      expect(await screen.findByText("No subjects match these filters")).toBeInTheDocument();
      expect(screen.queryByText("No subjects mapped yet")).not.toBeInTheDocument();
    });
  });

  describe("session", () => {
    it("asks for the current session's curriculum when the URL names none", async () => {
      renderScreen();

      expect(await screen.findByText("Mathematics")).toBeInTheDocument();
      expect(mockFetchCurriculumPage.mock.calls).toEqual([[DEFAULT_REQUEST]]);
    });

    it("opens a shared link with its session, filters, sort and page", async () => {
      setUrl(
        `/academics/curriculum?session=${PLANNED_SESSION_ID}&class=${CLASS_ID}` +
          "&kind=elective&sort=-weeklyPeriods&page=2",
      );
      mockFetchCurriculumPage.mockResolvedValue(
        curriculumPage([curriculumRecord()], { page: 2, totalPages: 3 }),
      );

      renderScreen();

      await waitFor(() => {
        expect(mockFetchCurriculumPage).toHaveBeenCalledWith({
          ...DEFAULT_REQUEST,
          page: 2,
          ordering: "-weekly_periods",
          academicSessionId: PLANNED_SESSION_ID,
          classId: CLASS_ID,
          isElective: true,
        });
      });
      expect(await screen.findByText("Mathematics")).toBeInTheDocument();
      expect(urlParams()).toEqual({
        session: PLANNED_SESSION_ID,
        class: CLASS_ID,
        kind: "elective",
        sort: "-weeklyPeriods",
        page: "2",
      });
    });

    it("falls back to the current session when the URL's session is not one", async () => {
      setUrl(`/academics/curriculum?session=${UNKNOWN_SESSION_ID}`);

      renderScreen();

      await waitFor(() => {
        expect(mockFetchCurriculumPage).toHaveBeenCalledWith(DEFAULT_REQUEST);
      });
      expect(mockFetchCurriculumPage).toHaveBeenCalledTimes(1);
    });

    it("sends no list request and shows the empty state when no session is current", async () => {
      mockFetchAcademicSessions.mockResolvedValue([PLANNED_SESSION, CLOSED_SESSION]);

      renderScreen();

      expect(await screen.findByText("No current academic session")).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "Academic session" })).toBeInTheDocument();
      expect(await screen.findByRole("button", { name: "Add subject" })).toBeDisabled();
      expect(mockFetchCurriculumPage).not.toHaveBeenCalled();
    });

    it("lets the viewer pick a session when none is current", async () => {
      mockFetchAcademicSessions.mockResolvedValue([PLANNED_SESSION, CLOSED_SESSION]);
      const user = userEvent.setup();

      renderScreen();

      // The empty state swaps in its own picker once the sessions load; open that one.
      await screen.findByText("No current academic session");
      await user.click(screen.getByRole("combobox", { name: "Academic session" }));
      await user.click(await screen.findByRole("option", { name: /2027-28/ }));

      expect(urlParams()).toEqual({ session: PLANNED_SESSION_ID });
      expect(await screen.findByText("Mathematics")).toBeInTheDocument();
      expect(mockFetchCurriculumPage).toHaveBeenCalledWith({
        ...DEFAULT_REQUEST,
        academicSessionId: PLANNED_SESSION_ID,
      });
    });

    it("shows a retryable error, not the empty state, when the sessions can't load", async () => {
      mockFetchAcademicSessions.mockRejectedValueOnce(new Error("down"));
      const user = userEvent.setup();

      renderScreen();

      expect(await screen.findByText("The curriculum couldn't be loaded.")).toBeInTheDocument();
      expect(screen.queryByText("No current academic session")).not.toBeInTheDocument();
      expect(mockFetchCurriculumPage).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Try again" }));

      expect(await screen.findByText("Mathematics")).toBeInTheDocument();
      expect(mockFetchCurriculumPage).toHaveBeenCalledWith(DEFAULT_REQUEST);
    });

    it("shows a retryable error when the list itself can't be loaded", async () => {
      mockFetchCurriculumPage.mockRejectedValueOnce(
        new ApiError({ code: "network_error", message: "", status: 0, url: "/class-subjects" }),
      );
      const user = userEvent.setup();

      renderScreen();

      expect(await screen.findByText(/we could not reach the server/i)).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Try again" }));

      expect(await screen.findByText("Mathematics")).toBeInTheDocument();
    });
  });

  describe("permissions and a locked session", () => {
    it("offers Add subject and Clone to a viewer who may create", async () => {
      renderScreen();

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Add subject" })).toBeEnabled();
      });
      expect(screen.getByRole("button", { name: "Clone from another session" })).toBeEnabled();
      const editButton = await screen.findByRole("button", { name: "Edit Mathematics, Grade 1" });
      const removeButton = screen.getByRole("button", { name: "Remove Mathematics, Grade 1" });
      expect(editButton).toBeInTheDocument();
      expect(removeButton).toBeInTheDocument();
    });

    it("keeps Add subject disabled until the viewer's permissions are known", async () => {
      mockFetchCurrentUser.mockReturnValue(new Promise<AuthenticatedUser>(() => undefined));

      renderScreen();

      expect(await screen.findByText("Mathematics")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add subject" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Clone from another session" })).toBeDisabled();
      expect(screen.getAllByTitle("Checking your permissions…")).toHaveLength(2);
    });

    it("says why the actions are disabled when the viewer's permissions can't load", async () => {
      mockFetchCurrentUser.mockRejectedValue(new Error("down"));

      renderScreen();

      const titled = await screen.findAllByTitle(
        "Your permissions couldn't be loaded. Reload the page to try again.",
      );
      expect(titled).toHaveLength(2);
      expect(screen.getByRole("button", { name: "Add subject" })).toBeDisabled();
    });

    it("hides Add and Clone from a viewer without curriculum.create", async () => {
      mockFetchCurrentUser.mockResolvedValue(
        userWith("academics.curriculum.update", "academics.curriculum.delete"),
      );

      renderScreen();

      // The row actions show only once the permissions have loaded, so the absence below
      // can't just be them still loading.
      const editButton = await screen.findByRole("button", { name: "Edit Mathematics, Grade 1" });
      expect(editButton).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add subject" })).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Clone from another session" }),
      ).not.toBeInTheDocument();
    });

    it("hides Edit and Remove from a viewer who may only view", async () => {
      mockFetchCurrentUser.mockResolvedValue(userWith("academics.curriculum.create"));

      renderScreen();

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Add subject" })).toBeEnabled();
      });
      expect(await screen.findByText("Mathematics")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^edit /i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^remove /i })).not.toBeInTheDocument();
    });

    it("hides every action and shows the notice for a locked session", async () => {
      setUrl(`/academics/curriculum?session=${CLOSED_SESSION_ID}`);
      const user = userEvent.setup();

      renderScreen();

      expect(
        await screen.findByText("2025-26 is closed, so its records are read-only."),
      ).toBeInTheDocument();
      // The rows come after the permissions (both wait on the same sessions), so a missing
      // action below is the lock, not the permissions still loading.
      expect(await screen.findByText("Mathematics")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add subject" })).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Clone from another session" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^edit /i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^remove /i })).not.toBeInTheDocument();

      // Back on the current session, the same viewer gets them all.
      await user.click(screen.getByRole("combobox", { name: "Academic session" }));
      await user.click(await screen.findByRole("option", { name: /2026-27/ }));

      expect(await screen.findByRole("button", { name: "Add subject" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Edit Mathematics, Grade 1" })).toBeInTheDocument();
      expect(screen.queryByText(/is closed, so its records are read-only/)).not.toBeInTheDocument();
    });
  });

  describe("filters and the URL", () => {
    it("writes a class filter to the URL, dropping the page", async () => {
      setUrl("/academics/curriculum?page=2");
      mockFetchCurriculumPage.mockImplementation((query) =>
        Promise.resolve(curriculumPage([curriculumRecord()], { page: query.page, totalPages: 3 })),
      );
      const user = userEvent.setup();

      renderScreen();

      await user.click(await screen.findByRole("combobox", { name: "Class" }));
      await user.click(await screen.findByRole("option", { name: "Grade 1" }));

      expect(urlParams()).toEqual({ class: CLASS_ID });
      await waitFor(() => {
        expect(mockFetchCurriculumPage).toHaveBeenLastCalledWith({
          ...DEFAULT_REQUEST,
          classId: CLASS_ID,
        });
      });
    });

    it("maps the kind filter onto is_elective: core is false", async () => {
      const user = userEvent.setup();

      renderScreen();

      await user.click(await screen.findByRole("combobox", { name: "Subject type" }));
      await user.click(await screen.findByRole("option", { name: "Core" }));

      expect(urlParams()).toEqual({ kind: "core" });
      await waitFor(() => {
        expect(mockFetchCurriculumPage).toHaveBeenLastCalledWith({
          ...DEFAULT_REQUEST,
          isElective: false,
        });
      });
    });

    it("filters by campus", async () => {
      const user = userEvent.setup();

      renderScreen();

      await user.click(await screen.findByRole("combobox", { name: "Campus" }));
      await user.click(await screen.findByRole("option", { name: "Main Campus" }));

      expect(urlParams()).toEqual({ campus: CAMPUS_ID });
      await waitFor(() => {
        expect(mockFetchCurriculumPage).toHaveBeenLastCalledWith({
          ...DEFAULT_REQUEST,
          campusId: CAMPUS_ID,
        });
      });
    });

    it("searches, trimmed, once typing settles", async () => {
      const user = userEvent.setup();

      renderScreen();

      await user.type(await screen.findByRole("textbox", { name: "Search" }), " Languages ");

      await waitFor(() => {
        expect(mockFetchCurriculumPage).toHaveBeenLastCalledWith({
          ...DEFAULT_REQUEST,
          search: "Languages",
        });
      });
    });

    it("lands on page 1 when a linked page no longer exists", async () => {
      setUrl("/academics/curriculum?page=9");
      mockFetchCurriculumPage.mockImplementation((query) =>
        query.page === 9
          ? Promise.reject(pageNotFound())
          : Promise.resolve(curriculumPage([curriculumRecord()])),
      );

      renderScreen();

      await waitFor(() => {
        expect(mockFetchCurriculumPage).toHaveBeenLastCalledWith(DEFAULT_REQUEST);
      });
      expect(mockFetchCurriculumPage).toHaveBeenCalledWith({ ...DEFAULT_REQUEST, page: 9 });
      expect(urlParams()).toEqual({});
      expect(await screen.findByText("Mathematics")).toBeInTheDocument();
      expect(screen.queryByText("The curriculum couldn't be loaded.")).not.toBeInTheDocument();
    });
  });

  describe("row actions", () => {
    it("opens the edit form for that row's mapping", async () => {
      const user = userEvent.setup();

      renderScreen();

      await user.click(await screen.findByRole("button", { name: "Edit Mathematics, Grade 1" }));

      const dialog = await screen.findByRole("dialog", { name: "Edit curriculum mapping" });
      expect(dialog).toBeInTheDocument();
    });

    it("opens the remove confirmation for that row's mapping", async () => {
      const user = userEvent.setup();

      renderScreen();

      await user.click(await screen.findByRole("button", { name: "Remove Mathematics, Grade 1" }));

      const dialog = await screen.findByRole("alertdialog", { name: "Remove this subject" });
      expect(dialog).toHaveTextContent("Mathematics will no longer be part of this class's");
    });

    it("opens the add form from the toolbar, on the screen's session", async () => {
      const user = userEvent.setup();

      renderScreen();

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Add subject" })).toBeEnabled();
      });
      await user.click(screen.getByRole("button", { name: "Add subject" }));

      const dialog = await screen.findByRole("dialog", { name: "Add a subject to a class" });
      expect(dialog).toBeInTheDocument();
    });

    it("opens the clone dialog from the toolbar", async () => {
      const user = userEvent.setup();

      renderScreen();

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Clone from another session" })).toBeEnabled();
      });
      await user.click(screen.getByRole("button", { name: "Clone from another session" }));

      expect(await screen.findByRole("dialog", { name: "Clone curriculum" })).toBeInTheDocument();
    });
  });
});
