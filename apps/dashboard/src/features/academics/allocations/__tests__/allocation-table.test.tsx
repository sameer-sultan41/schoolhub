import { ApiError } from "@schoolhub/api-client";
import type { AuthenticatedUser, PermissionKey } from "@schoolhub/types";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { todayIsoDate } from "@/lib/helpers";
import { Services } from "@/services";
import {
  allocationPage,
  allocationRecord,
  OTHER_CLASS_ID,
  OTHER_SECTION_ID,
  SECTION_ID,
  STAFF_ID,
  teacherRecord,
} from "@/services/modules/teacher-allocations/__tests__/teacher-allocations-fixtures";
import {
  CLASS_ID,
  CLOSED_SESSION,
  CLOSED_SESSION_ID,
  PLANNED_SESSION,
  PLANNED_SESSION_ID,
  SESSION_ID,
  SESSIONS,
  SUBJECT_ID,
  UNKNOWN_SESSION_ID,
} from "@/test-fixtures/academics";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { AllocationTable } from "../allocation-table";
import { AllocationToolbar } from "../allocation-toolbar";

// The list's view state lives in the URL; this keeps one in memory.
jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

// Saving and removing surface as toasts, and `renderWithProviders` mounts no `<Toaster/>`.
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

// The toolbar, the filters and the row dialogs each fire their own queries the instant they
// render or open: every Service they call needs a default, or a test crashes with "not a
// function" the moment a dialog opens.
jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    auth: { fetchCurrentUser: jest.fn() },
    teacherAllocations: {
      fetchAllocationsPage: jest.fn(),
      allocateTeacher: jest.fn(),
      updateAllocation: jest.fn(),
      endAllocation: jest.fn(),
      reinstateAllocation: jest.fn(),
      deleteAllocation: jest.fn(),
      fetchLoadSummary: jest.fn(),
    },
    curriculum: { fetchCurriculumForClass: jest.fn() },
    staff: { fetchTeachingStaffOptions: jest.fn() },
    schoolOrganization: {
      fetchClasses: jest.fn(),
      fetchSubjects: jest.fn(),
      fetchSections: jest.fn(),
      fetchAcademicSessions: jest.fn(),
    },
  },
}));

const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;
const mockFetchAllocationsPage = Services.teacherAllocations
  .fetchAllocationsPage as jest.MockedFunction<
  typeof Services.teacherAllocations.fetchAllocationsPage
>;
const mockFetchLoadSummary = Services.teacherAllocations.fetchLoadSummary as jest.MockedFunction<
  typeof Services.teacherAllocations.fetchLoadSummary
>;
const mockFetchCurriculumForClass = Services.curriculum
  .fetchCurriculumForClass as jest.MockedFunction<
  typeof Services.curriculum.fetchCurriculumForClass
>;
const mockFetchTeachingStaff = Services.staff.fetchTeachingStaffOptions as jest.MockedFunction<
  typeof Services.staff.fetchTeachingStaffOptions
>;
const mockFetchClasses = Services.schoolOrganization.fetchClasses as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchClasses
>;
const mockFetchSubjects = Services.schoolOrganization.fetchSubjects as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchSubjects
>;
const mockFetchSections = Services.schoolOrganization.fetchSections as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchSections
>;
const mockFetchAcademicSessions = Services.schoolOrganization
  .fetchAcademicSessions as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchAcademicSessions
>;

const ENDED_ID = "5d6e7f8a-9b0c-4d1e-8f2a-3b4c5d6e7f8a";
const FUTURE_ID = "6e7f8a9b-0c1d-4e2f-9a3b-4c5d6e7f8a9b";
const FAR_FUTURE = "2999-12-31";

/** What the list requests with nothing in the URL: the current session's current allocations,
 * sorted by section. */
const DEFAULT_REQUEST = {
  page: 1,
  pageSize: 10,
  search: undefined,
  ordering: "section_name",
  academicSessionId: SESSION_ID,
  classId: undefined,
  sectionId: undefined,
  subjectId: undefined,
  staffId: undefined,
  current: true,
};

/** A viewer of the screen, plus whatever else a test grants. */
function userWith(...permissions: PermissionKey[]): AuthenticatedUser {
  return buildUser(["academics.teacher-allocation.view", ...permissions]);
}

const FULL_ACCESS = userWith(
  "academics.teacher-allocation.create",
  "academics.teacher-allocation.update",
  "academics.teacher-allocation.delete",
);

/** What DRF's page-number pagination answers for a page past the end. */
function pageNotFound() {
  return new ApiError({
    code: "not_found",
    message: "Invalid page.",
    status: 404,
    url: "/teacher-subject-allocations",
  });
}

/** The address bar's current query, as key/value pairs. */
function urlParams() {
  return Object.fromEntries(new URLSearchParams(window.location.search));
}

/** The table row holding `text`. */
function rowOf(text: string): HTMLElement {
  const row = screen.getByText(text).closest("tr");
  if (!row) throw new Error(`No table row holds "${text}"`);
  return row;
}

/** The screen as the page composes it: the toolbar above the table. */
function renderScreen() {
  return renderWithProviders(
    <>
      <AllocationToolbar />
      <AllocationTable />
    </>,
  );
}

/** The row-action button names for the default allocation. */
const LABEL = "Ayesha Khan, Mathematics, Grade 1 · A";

describe("AllocationTable", () => {
  beforeEach(() => {
    setUrl("/academics/allocations");
    mockFetchCurrentUser.mockReset().mockResolvedValue(FULL_ACCESS);
    mockFetchAcademicSessions.mockReset().mockResolvedValue(SESSIONS);
    mockFetchAllocationsPage.mockReset().mockResolvedValue(allocationPage([allocationRecord()]));
    // Empty, so the load panel's own teacher names never double up with the table's.
    mockFetchLoadSummary.mockReset().mockResolvedValue([]);
    mockFetchCurriculumForClass.mockReset().mockResolvedValue([]);
    mockFetchTeachingStaff.mockReset().mockResolvedValue([teacherRecord()]);
    mockFetchClasses.mockReset().mockResolvedValue([
      { id: CLASS_ID, name: "Grade 1" },
      { id: OTHER_CLASS_ID, name: "Grade 2" },
    ]);
    mockFetchSubjects.mockReset().mockResolvedValue([{ id: SUBJECT_ID, name: "Mathematics" }]);
    mockFetchSections
      .mockReset()
      .mockResolvedValue([{ id: SECTION_ID, name: "A", campus_id: "campus-1" }]);
  });

  describe("rows", () => {
    it("shows each allocation's section, subject, teacher, role, periods and state", async () => {
      mockFetchAllocationsPage.mockResolvedValue(
        allocationPage([
          allocationRecord({ weekly_periods: 6 }),
          allocationRecord({
            id: ENDED_ID,
            subject_name: "English",
            staff_name: "Bilal Ahmed",
            is_primary: false,
            weekly_periods: null,
            effective_to: "2026-09-30",
          }),
          allocationRecord({
            id: FUTURE_ID,
            subject_name: "Science",
            staff_name: "Zainab Bibi",
            effective_from: FAR_FUTURE,
          }),
        ]),
      );

      renderScreen();

      expect(await screen.findByText("Mathematics")).toBeInTheDocument();
      const current = rowOf("Mathematics");
      expect(within(current).getByText("Grade 1 · A")).toBeInTheDocument();
      expect(within(current).getByText("Ayesha Khan")).toBeInTheDocument();
      expect(within(current).getByText("Primary")).toBeInTheDocument();
      expect(within(current).getByText("6")).toBeInTheDocument();
      expect(within(current).getByText("Current")).toBeInTheDocument();

      const ended = rowOf("English");
      expect(within(ended).getByText("Co-teacher")).toBeInTheDocument();
      // No override: the dash stands for the curriculum's own target.
      expect(within(ended).getByText("Curriculum default")).toBeInTheDocument();
      expect(within(ended).getByText("Ended September 30th, 2026")).toBeInTheDocument();

      const upcoming = rowOf("Science");
      expect(within(upcoming).getByText("Starts December 31st, 2999")).toBeInTheDocument();
    });

    it("says nothing is allocated yet when there are no rows and no filter", async () => {
      mockFetchAllocationsPage.mockResolvedValue(allocationPage([]));

      renderScreen();

      expect(await screen.findByText("No teachers allocated yet")).toBeInTheDocument();
    });

    it("says no allocations match once a filter is applied", async () => {
      mockFetchAllocationsPage.mockResolvedValue(allocationPage([]));
      setUrl("/academics/allocations?state=ended");

      renderScreen();

      expect(await screen.findByText("No allocations match these filters")).toBeInTheDocument();
      expect(screen.queryByText("No teachers allocated yet")).not.toBeInTheDocument();
    });

    it("shows the teacher load panel above the list for the screen's session", async () => {
      renderScreen();

      expect(await screen.findByText("Mathematics")).toBeInTheDocument();
      await waitFor(() => {
        expect(mockFetchLoadSummary).toHaveBeenCalledWith(SESSION_ID);
      });
      expect(screen.getByText("Teacher load")).toBeInTheDocument();
    });
  });

  describe("session", () => {
    it("asks for the current session's current allocations when the URL names none", async () => {
      renderScreen();

      expect(await screen.findByText("Mathematics")).toBeInTheDocument();
      expect(mockFetchAllocationsPage.mock.calls).toEqual([[DEFAULT_REQUEST]]);
    });

    it("opens a shared link with its session, filters, sort and page", async () => {
      setUrl(
        `/academics/allocations?session=${PLANNED_SESSION_ID}&class=${CLASS_ID}` +
          `&section=${SECTION_ID}&subject=${SUBJECT_ID}&teacher=${STAFF_ID}` +
          "&state=ended&sort=-weeklyPeriods&page=2",
      );
      mockFetchAllocationsPage.mockResolvedValue(
        allocationPage([allocationRecord()], { page: 2, totalPages: 3 }),
      );

      renderScreen();

      await waitFor(() => {
        expect(mockFetchAllocationsPage).toHaveBeenCalledWith({
          ...DEFAULT_REQUEST,
          page: 2,
          ordering: "-weekly_periods",
          academicSessionId: PLANNED_SESSION_ID,
          classId: CLASS_ID,
          sectionId: SECTION_ID,
          subjectId: SUBJECT_ID,
          staffId: STAFF_ID,
          current: false,
        });
      });
      expect(await screen.findByText("Mathematics")).toBeInTheDocument();
      expect(urlParams()).toEqual({
        session: PLANNED_SESSION_ID,
        class: CLASS_ID,
        section: SECTION_ID,
        subject: SUBJECT_ID,
        teacher: STAFF_ID,
        state: "ended",
        sort: "-weeklyPeriods",
        page: "2",
      });
    });

    it.each<[string, boolean | undefined]>([
      ["current", true],
      ["ended", false],
      ["all", undefined],
    ])("sends current for the %s state as %s (omitted for all)", async (state, current) => {
      setUrl(`/academics/allocations?state=${state}`);

      renderScreen();

      await waitFor(() => {
        expect(mockFetchAllocationsPage).toHaveBeenCalledWith({ ...DEFAULT_REQUEST, current });
      });
      // `all` must not send `current` at all, not even as false.
      const sent = mockFetchAllocationsPage.mock.calls.map(([query]) => query.current);
      expect(sent).toEqual([current]);
    });

    it("falls back to the current session when the URL's session is not one", async () => {
      setUrl(`/academics/allocations?session=${UNKNOWN_SESSION_ID}`);

      renderScreen();

      await waitFor(() => {
        expect(mockFetchAllocationsPage).toHaveBeenCalledWith(DEFAULT_REQUEST);
      });
      expect(mockFetchAllocationsPage).toHaveBeenCalledTimes(1);
    });

    it("sends no request and shows the empty state when no session is current", async () => {
      mockFetchAcademicSessions.mockResolvedValue([PLANNED_SESSION, CLOSED_SESSION]);

      renderScreen();

      expect(await screen.findByText("No current academic session")).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "Academic session" })).toBeInTheDocument();
      expect(await screen.findByRole("button", { name: "Allocate a teacher" })).toBeDisabled();
      expect(mockFetchAllocationsPage).not.toHaveBeenCalled();
      expect(mockFetchLoadSummary).not.toHaveBeenCalled();
    });

    it("lets the viewer pick a session when none is current", async () => {
      mockFetchAcademicSessions.mockResolvedValue([PLANNED_SESSION, CLOSED_SESSION]);
      const user = userEvent.setup();

      renderScreen();

      // The empty state mounts its own picker once the sessions load, replacing the filter bar's.
      await screen.findByText("No current academic session");
      await user.click(screen.getByRole("combobox", { name: "Academic session" }));
      await user.click(await screen.findByRole("option", { name: /2027-28/ }));

      expect(urlParams()).toEqual({ session: PLANNED_SESSION_ID });
      expect(await screen.findByText("Mathematics")).toBeInTheDocument();
      expect(mockFetchAllocationsPage).toHaveBeenCalledWith({
        ...DEFAULT_REQUEST,
        academicSessionId: PLANNED_SESSION_ID,
      });
    });

    it("shows a retryable error, not the empty state, when the sessions can't load", async () => {
      mockFetchAcademicSessions.mockRejectedValueOnce(new Error("down"));
      const user = userEvent.setup();

      renderScreen();

      expect(
        await screen.findByText("The teacher allocations couldn't be loaded."),
      ).toBeInTheDocument();
      expect(screen.queryByText("No current academic session")).not.toBeInTheDocument();
      expect(mockFetchAllocationsPage).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Try again" }));

      expect(await screen.findByText("Mathematics")).toBeInTheDocument();
      expect(mockFetchAllocationsPage).toHaveBeenCalledWith(DEFAULT_REQUEST);
    });

    it("shows a retryable error when the list itself can't be loaded", async () => {
      mockFetchAllocationsPage.mockRejectedValueOnce(
        new ApiError({
          code: "network_error",
          message: "",
          status: 0,
          url: "/teacher-subject-allocations",
        }),
      );
      const user = userEvent.setup();

      renderScreen();

      expect(await screen.findByText(/we could not reach the server/i)).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Try again" }));

      expect(await screen.findByText("Mathematics")).toBeInTheDocument();
    });
  });

  describe("permissions and a locked session", () => {
    it("offers Allocate and each row action that applies to a full-access viewer", async () => {
      renderScreen();

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Allocate a teacher" })).toBeEnabled();
      });
      expect(await screen.findByRole("button", { name: `Edit ${LABEL}` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `End ${LABEL}` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Remove ${LABEL}` })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^reinstate /i })).not.toBeInTheDocument();
    });

    it("keeps Allocate disabled until the viewer's permissions are known", async () => {
      mockFetchCurrentUser.mockReturnValue(new Promise<AuthenticatedUser>(() => undefined));

      renderScreen();

      expect(await screen.findByText("Mathematics")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Allocate a teacher" })).toBeDisabled();
      expect(screen.getByTitle("Checking your permissions…")).toBeInTheDocument();
    });

    it("says why Allocate is disabled when the viewer's permissions can't load", async () => {
      mockFetchCurrentUser.mockRejectedValue(new Error("down"));

      renderScreen();

      expect(
        await screen.findByTitle(
          "Your permissions couldn't be loaded. Reload the page to try again.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Allocate a teacher" })).toBeDisabled();
    });

    it("hides Allocate from a viewer without teacher-allocation.create", async () => {
      mockFetchCurrentUser.mockResolvedValue(
        userWith("academics.teacher-allocation.update", "academics.teacher-allocation.delete"),
      );

      renderScreen();

      // The row actions show only once the permissions have loaded, so the absence below
      // can't just be them still loading.
      expect(await screen.findByRole("button", { name: `Edit ${LABEL}` })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Allocate a teacher" })).not.toBeInTheDocument();
    });

    it("hides every row action from a viewer who may only create", async () => {
      mockFetchCurrentUser.mockResolvedValue(userWith("academics.teacher-allocation.create"));

      renderScreen();

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Allocate a teacher" })).toBeEnabled();
      });
      expect(await screen.findByText("Mathematics")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^edit /i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^end /i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^remove /i })).not.toBeInTheDocument();
    });

    it("offers Edit and End, but not Remove, to a viewer with only .update", async () => {
      mockFetchCurrentUser.mockResolvedValue(userWith("academics.teacher-allocation.update"));

      renderScreen();

      expect(await screen.findByRole("button", { name: `Edit ${LABEL}` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `End ${LABEL}` })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^remove /i })).not.toBeInTheDocument();
    });

    it("offers Remove alone to a viewer with only .delete", async () => {
      mockFetchCurrentUser.mockResolvedValue(userWith("academics.teacher-allocation.delete"));

      renderScreen();

      expect(await screen.findByRole("button", { name: `Remove ${LABEL}` })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^edit /i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^end /i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^reinstate /i })).not.toBeInTheDocument();
    });

    it("hides every action and shows the notice for a locked session", async () => {
      setUrl(`/academics/allocations?session=${CLOSED_SESSION_ID}`);
      mockFetchAllocationsPage.mockResolvedValue(
        allocationPage([
          allocationRecord(),
          allocationRecord({ id: ENDED_ID, subject_name: "English", effective_to: "2026-01-31" }),
        ]),
      );
      const user = userEvent.setup();

      renderScreen();

      expect(
        await screen.findByText("2025-26 is closed, so its records are read-only."),
      ).toBeInTheDocument();
      // The rows come after the permissions (both wait on the same sessions), so a missing
      // action below is the lock, not the permissions still loading.
      expect(await screen.findByText("Mathematics")).toBeInTheDocument();
      expect(screen.getByText("English")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Allocate a teacher" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^edit /i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^end /i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^reinstate /i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^remove /i })).not.toBeInTheDocument();

      // Back on the current session, the same viewer gets them all.
      await user.click(screen.getByRole("combobox", { name: "Academic session" }));
      await user.click(await screen.findByRole("option", { name: /2026-27/ }));

      expect(await screen.findByRole("button", { name: "Allocate a teacher" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Edit ${LABEL}` })).toBeInTheDocument();
      expect(screen.queryByText(/is closed, so its records are read-only/)).not.toBeInTheDocument();
    });
  });

  describe("row actions by the allocation's state", () => {
    it("offers Edit, End and Remove for a current allocation that has started", async () => {
      renderScreen();

      expect(await screen.findByRole("button", { name: `End ${LABEL}` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Edit ${LABEL}` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Remove ${LABEL}` })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^reinstate /i })).not.toBeInTheDocument();
    });

    it("still offers End for an allocation that starts today", async () => {
      mockFetchAllocationsPage.mockResolvedValue(
        allocationPage([allocationRecord({ effective_from: todayIsoDate() })]),
      );

      renderScreen();

      expect(await screen.findByRole("button", { name: `End ${LABEL}` })).toBeInTheDocument();
    });

    it("offers Remove, not End, for an allocation that has not started yet", async () => {
      mockFetchAllocationsPage.mockResolvedValue(
        allocationPage([allocationRecord({ effective_from: FAR_FUTURE })]),
      );

      renderScreen();

      expect(await screen.findByRole("button", { name: `Remove ${LABEL}` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Edit ${LABEL}` })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^end /i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^reinstate /i })).not.toBeInTheDocument();
    });

    it("offers Reinstate, not End, for an ended allocation", async () => {
      mockFetchAllocationsPage.mockResolvedValue(
        allocationPage([allocationRecord({ effective_to: "2026-09-30" })]),
      );

      renderScreen();

      expect(await screen.findByRole("button", { name: `Reinstate ${LABEL}` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Edit ${LABEL}` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Remove ${LABEL}` })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^end /i })).not.toBeInTheDocument();
    });

    it("offers Reinstate only to a viewer who may update", async () => {
      mockFetchAllocationsPage.mockResolvedValue(
        allocationPage([allocationRecord({ effective_to: "2026-09-30" })]),
      );
      mockFetchCurrentUser.mockResolvedValue(userWith("academics.teacher-allocation.delete"));

      renderScreen();

      expect(await screen.findByRole("button", { name: `Remove ${LABEL}` })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^reinstate /i })).not.toBeInTheDocument();
    });
  });

  describe("filters and the URL", () => {
    it("writes a class filter to the URL, dropping the page", async () => {
      setUrl("/academics/allocations?page=2");
      mockFetchAllocationsPage.mockImplementation((query) =>
        Promise.resolve(allocationPage([allocationRecord()], { page: query.page, totalPages: 3 })),
      );
      const user = userEvent.setup();

      renderScreen();

      await user.click(await screen.findByRole("combobox", { name: "Class" }));
      await user.click(await screen.findByRole("option", { name: "Grade 1" }));

      expect(urlParams()).toEqual({ class: CLASS_ID });
      await waitFor(() => {
        expect(mockFetchAllocationsPage).toHaveBeenLastCalledWith({
          ...DEFAULT_REQUEST,
          classId: CLASS_ID,
        });
      });
    });

    it("clears the section in the same write when the class changes", async () => {
      setUrl(`/academics/allocations?class=${CLASS_ID}&section=${SECTION_ID}`);
      const user = userEvent.setup();

      renderScreen();

      await waitFor(() => {
        expect(mockFetchAllocationsPage).toHaveBeenCalledWith({
          ...DEFAULT_REQUEST,
          classId: CLASS_ID,
          sectionId: SECTION_ID,
        });
      });
      await user.click(screen.getByRole("combobox", { name: "Class" }));
      await user.click(await screen.findByRole("option", { name: "Grade 2" }));

      expect(urlParams()).toEqual({ class: OTHER_CLASS_ID });
      await waitFor(() => {
        expect(mockFetchAllocationsPage).toHaveBeenLastCalledWith({
          ...DEFAULT_REQUEST,
          classId: OTHER_CLASS_ID,
        });
      });
      // Never the new class with the old section, not even for one request.
      expect(mockFetchAllocationsPage).not.toHaveBeenCalledWith(
        expect.objectContaining({ classId: OTHER_CLASS_ID, sectionId: SECTION_ID }),
      );
    });

    it("filters by one of the class's sections", async () => {
      setUrl(`/academics/allocations?class=${CLASS_ID}`);
      const user = userEvent.setup();

      renderScreen();

      await user.click(await screen.findByRole("combobox", { name: "Section" }));
      await user.click(await screen.findByRole("option", { name: "A" }));

      expect(urlParams()).toEqual({ class: CLASS_ID, section: SECTION_ID });
      await waitFor(() => {
        expect(mockFetchAllocationsPage).toHaveBeenLastCalledWith({
          ...DEFAULT_REQUEST,
          classId: CLASS_ID,
          sectionId: SECTION_ID,
        });
      });
    });

    it("keeps the section filter disabled until a class is chosen", async () => {
      renderScreen();

      expect(await screen.findByRole("combobox", { name: "Section" })).toBeDisabled();
    });

    it("drops a section that isn't one of the class's sections once they load", async () => {
      setUrl(`/academics/allocations?class=${CLASS_ID}&section=${SECTION_ID}`);
      mockFetchSections.mockResolvedValue([
        { id: OTHER_SECTION_ID, name: "B", campus_id: "campus-1" },
      ]);

      renderScreen();

      await waitFor(() => {
        expect(urlParams()).toEqual({ class: CLASS_ID });
      });
      await waitFor(() => {
        expect(mockFetchAllocationsPage).toHaveBeenLastCalledWith({
          ...DEFAULT_REQUEST,
          classId: CLASS_ID,
        });
      });
    });

    it("ignores a section in the URL that has no class", async () => {
      // A section is a valid id here, but means nothing without its class.
      setUrl(`/academics/allocations?section=${SECTION_ID}`);

      renderScreen();

      await waitFor(() => {
        expect(mockFetchAllocationsPage).toHaveBeenCalledWith(DEFAULT_REQUEST);
      });
      expect(mockFetchAllocationsPage).toHaveBeenCalledTimes(1);
    });

    it("filters by subject", async () => {
      const user = userEvent.setup();

      renderScreen();

      await user.click(await screen.findByRole("combobox", { name: "Subject" }));
      await user.click(await screen.findByRole("option", { name: "Mathematics" }));

      expect(urlParams()).toEqual({ subject: SUBJECT_ID });
      await waitFor(() => {
        expect(mockFetchAllocationsPage).toHaveBeenLastCalledWith({
          ...DEFAULT_REQUEST,
          subjectId: SUBJECT_ID,
        });
      });
    });

    it("filters by teacher", async () => {
      const user = userEvent.setup();

      renderScreen();

      await user.click(await screen.findByRole("combobox", { name: "Teacher" }));
      await user.click(await screen.findByRole("option", { name: "Ayesha Khan" }));

      expect(urlParams()).toEqual({ teacher: STAFF_ID });
      await waitFor(() => {
        expect(mockFetchAllocationsPage).toHaveBeenLastCalledWith({
          ...DEFAULT_REQUEST,
          staffId: STAFF_ID,
        });
      });
    });

    it("filters by state: ended is current=false, and back to current leaves the URL", async () => {
      const user = userEvent.setup();

      renderScreen();

      await user.click(await screen.findByRole("combobox", { name: "Status" }));
      await user.click(await screen.findByRole("option", { name: "Ended" }));

      expect(urlParams()).toEqual({ state: "ended" });
      await waitFor(() => {
        expect(mockFetchAllocationsPage).toHaveBeenLastCalledWith({
          ...DEFAULT_REQUEST,
          current: false,
        });
      });

      await user.click(screen.getByRole("combobox", { name: "Status" }));
      await user.click(await screen.findByRole("option", { name: "Current" }));

      expect(urlParams()).toEqual({});
    });

    it("searches, trimmed, once typing settles", async () => {
      const user = userEvent.setup();

      renderScreen();

      await user.type(await screen.findByRole("textbox", { name: "Search" }), " Khan ");

      await waitFor(() => {
        expect(mockFetchAllocationsPage).toHaveBeenLastCalledWith({
          ...DEFAULT_REQUEST,
          search: "Khan",
        });
      });
    });

    it("lands on page 1 when a linked page no longer exists", async () => {
      setUrl("/academics/allocations?page=9");
      mockFetchAllocationsPage.mockImplementation((query) =>
        query.page === 9
          ? Promise.reject(pageNotFound())
          : Promise.resolve(allocationPage([allocationRecord()])),
      );

      renderScreen();

      await waitFor(() => {
        expect(mockFetchAllocationsPage).toHaveBeenLastCalledWith(DEFAULT_REQUEST);
      });
      expect(mockFetchAllocationsPage).toHaveBeenCalledWith({ ...DEFAULT_REQUEST, page: 9 });
      expect(urlParams()).toEqual({});
      expect(await screen.findByText("Mathematics")).toBeInTheDocument();
      expect(
        screen.queryByText("The teacher allocations couldn't be loaded."),
      ).not.toBeInTheDocument();
    });
  });

  describe("opening a dialog", () => {
    it("opens the edit form for that row's allocation", async () => {
      const user = userEvent.setup();

      renderScreen();

      await user.click(await screen.findByRole("button", { name: `Edit ${LABEL}` }));

      expect(await screen.findByRole("dialog", { name: "Edit allocation" })).toBeInTheDocument();
    });

    it("opens the end confirmation for that row's allocation", async () => {
      const user = userEvent.setup();

      renderScreen();

      await user.click(await screen.findByRole("button", { name: `End ${LABEL}` }));

      expect(
        await screen.findByRole("alertdialog", { name: "End this allocation" }),
      ).toBeInTheDocument();
    });

    it("opens the reinstate confirmation for an ended row", async () => {
      mockFetchAllocationsPage.mockResolvedValue(
        allocationPage([allocationRecord({ effective_to: "2026-09-30" })]),
      );
      const user = userEvent.setup();

      renderScreen();

      await user.click(await screen.findByRole("button", { name: `Reinstate ${LABEL}` }));

      expect(
        await screen.findByRole("alertdialog", { name: "Reinstate this allocation" }),
      ).toBeInTheDocument();
    });

    it("opens the remove confirmation for that row's allocation", async () => {
      const user = userEvent.setup();

      renderScreen();

      await user.click(await screen.findByRole("button", { name: `Remove ${LABEL}` }));

      expect(
        await screen.findByRole("alertdialog", { name: "Remove this allocation" }),
      ).toBeInTheDocument();
    });

    it("opens the allocate form from the toolbar, on the screen's session", async () => {
      const user = userEvent.setup();

      renderScreen();

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Allocate a teacher" })).toBeEnabled();
      });
      await user.click(screen.getByRole("button", { name: "Allocate a teacher" }));

      expect(await screen.findByRole("dialog", { name: "Allocate a teacher" })).toBeInTheDocument();
    });

    it("closes a row dialog on Cancel, leaving the list as it was", async () => {
      const user = userEvent.setup();

      renderScreen();

      await user.click(await screen.findByRole("button", { name: `End ${LABEL}` }));
      await user.click(await screen.findByRole("button", { name: "Cancel" }));

      await waitFor(() => {
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      });
      expect(screen.getByText("Mathematics")).toBeInTheDocument();
    });
  });
});
