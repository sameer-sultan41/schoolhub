import { ApiError } from "@schoolhub/api-client";
import type { AuthenticatedUser } from "@schoolhub/types";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import type { StudentRecord } from "@/services";
import type { BackgroundJobRecord } from "@/services/modules/jobs/jobs-service";
import { renderWithProviders } from "@/test-utils";

import { StudentDirectoryTable } from "../student-directory-table";

// `StudentCreateStepper` (edit mode), `StudentDetailSheet`, `WithdrawStudentDialog` and
// `StudentIdCardsButton` (its job polling) all render from this table and each fires its own
// (`enabled`-gated, in the detail sheet's and edit stepper's case) queries/mutations the
// instant they're opened — the mock object itself needs every one of these present (resolved
// to a sane default) or a test crashes with "not a function" the moment a dialog opens, same
// reasoning as `staff-directory-table.test.tsx`'s own mock.
jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    auth: { fetchCurrentUser: jest.fn() },
    students: {
      fetchStudentsPage: jest.fn(),
      fetchStudentById: jest.fn(),
      withdrawStudent: jest.fn(),
      generateIdCards: jest.fn(),
      fetchStudentHistory: jest.fn().mockResolvedValue([]),
    },
    jobs: { fetchJob: jest.fn(), fetchFileDownloadUrl: jest.fn() },
    dashboard: { fetchCampuses: jest.fn().mockResolvedValue([]) },
    schoolOrganization: {
      fetchHouses: jest.fn().mockResolvedValue([]),
      fetchClasses: jest.fn().mockResolvedValue([]),
      fetchSections: jest.fn().mockResolvedValue([]),
      fetchAcademicSessions: jest.fn().mockResolvedValue([]),
    },
    studentTransfers: { fetchStudentTransfers: jest.fn().mockResolvedValue([]) },
  },
}));

const mockFetchStudentsPage = Services.students.fetchStudentsPage as jest.MockedFunction<
  typeof Services.students.fetchStudentsPage
>;
const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;
const mockFetchCampuses = Services.dashboard.fetchCampuses as jest.MockedFunction<
  typeof Services.dashboard.fetchCampuses
>;
const mockFetchStudentById = Services.students.fetchStudentById as jest.MockedFunction<
  typeof Services.students.fetchStudentById
>;
const mockFetchHouses = Services.schoolOrganization.fetchHouses as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchHouses
>;
const mockGenerateIdCards = Services.students.generateIdCards as jest.MockedFunction<
  typeof Services.students.generateIdCards
>;
const mockFetchJob = Services.jobs.fetchJob as jest.MockedFunction<typeof Services.jobs.fetchJob>;

// Every permission this table reads, granted — individual tests only care about row
// data/filters/errors, not permission gating, so a full grant is the sane default; the
// row-status-based Withdraw-visibility tests below rely on `canWithdraw` being true here
// so they actually exercise the `row.status === "active"` gate, not a masked permission.
const PERMITTED_USER: AuthenticatedUser = {
  id: "u1",
  email: "records@example.com",
  phone: null,
  full_name: "Records Manager",
  avatar_url: null,
  locale: "en",
  tenant_id: "tenant-1",
  roles: [],
  permissions: ["students.student.view", "students.student.update", "students.student.withdraw"],
};

const ID_CARD_USER: AuthenticatedUser = {
  ...PERMITTED_USER,
  permissions: [...PERMITTED_USER.permissions, "students.id-card.generate"],
};

/** Same shape as `withdraw-student-dialog.test.tsx`'s own `studentRecord` fixture —
 * every nullable field defaults to a real, non-null value so an override only ever
 * changes the field a given test actually cares about. */
function studentRecord(overrides: Partial<StudentRecord> = {}): StudentRecord {
  return {
    id: "stu-1",
    admission_number: "2026-0050",
    first_name: "Aisha",
    last_name: "Khan",
    preferred_name: "Ash",
    date_of_birth: "2015-03-12",
    gender: "female",
    photo_file_id: null,
    photo_url: null,
    campus_id: "campus-1",
    campus_name: "Main Campus",
    house_id: "house-1",
    house_name: "Blue House",
    status: "active",
    admission_date: "2026-01-10",
    blood_group: "O+",
    nationality: "Pakistani",
    religion: "Islam",
    previous_school: "City Grammar School",
    medical_notes: "No known allergies.",
    address: null,
    custom_fields: null,
    created_at: "2026-01-10T00:00:00Z",
    updated_at: "2026-09-20T00:00:00Z",
    ...overrides,
  };
}

describe("StudentDirectoryTable", () => {
  beforeEach(() => {
    mockFetchStudentsPage.mockReset();
    mockFetchCurrentUser.mockReset().mockResolvedValue(PERMITTED_USER);
    mockFetchCampuses.mockReset().mockResolvedValue([]);
    mockGenerateIdCards.mockReset();
    mockFetchJob.mockReset();
  });

  it("filters by campus", async () => {
    mockFetchStudentsPage.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 10, total_count: 0, total_pages: 0 },
    });
    mockFetchCampuses.mockResolvedValue([{ id: "c1", name: "Main Campus" }]);

    renderWithProviders(<StudentDirectoryTable />);

    await userEvent.setup().click(await screen.findByRole("combobox", { name: /campus/i }));
    await userEvent.setup().click(await screen.findByRole("option", { name: "Main Campus" }));

    await waitFor(() => {
      expect(mockFetchStudentsPage).toHaveBeenCalledWith(
        expect.objectContaining({ campusId: "c1", page: 1 }),
      );
    });
  });

  it("filters by house", async () => {
    mockFetchStudentsPage.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 10, total_count: 0, total_pages: 0 },
    });
    mockFetchHouses.mockResolvedValue([{ id: "h1", name: "Griffin" }]);

    renderWithProviders(<StudentDirectoryTable />);

    await userEvent.setup().click(await screen.findByRole("combobox", { name: /house/i }));
    await userEvent.setup().click(await screen.findByRole("option", { name: "Griffin" }));

    await waitFor(() => {
      expect(mockFetchStudentsPage).toHaveBeenCalledWith(
        expect.objectContaining({ houseId: "h1", page: 1 }),
      );
    });
  });

  it("shows the unfiltered empty state when there are simply no students yet", async () => {
    // The directory's status filter defaults to "active", not "all" — that default
    // alone must not read as "filtered" (round-4 review finding: an earlier version of
    // this test asserted `noMatches` with no filter actually changed, which can never
    // be true since `hasActiveFilter` is false at the default and `list.emptyTitle`
    // renders instead).
    mockFetchStudentsPage.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 10, total_count: 0, total_pages: 0 },
    });

    renderWithProviders(<StudentDirectoryTable />);

    expect(await screen.findByText(/no students yet/i)).toBeInTheDocument();
  });

  it("shows a not-forbidden, not-broken empty state for a legitimately empty *filtered* result", async () => {
    mockFetchStudentsPage.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 10, total_count: 0, total_pages: 0 },
    });

    renderWithProviders(<StudentDirectoryTable />);

    // The search `Input`'s `aria-label` is `t("filters.search")` — the real
    // en.json value is just "Search" (point 3's pinned i18n key), not "Search students".
    await userEvent.setup().type(screen.getByRole("textbox", { name: /^search$/i }), "nonexistent");

    await waitFor(() => {
      expect(mockFetchStudentsPage).toHaveBeenCalledWith(
        expect.objectContaining({ search: "nonexistent" }),
      );
    });
    expect(await screen.findByText(/no students match these filters/i)).toBeInTheDocument();
    expect(screen.queryByText(/don't have permission/i)).not.toBeInTheDocument();
  });

  it("hides the row-level Withdraw action for a graduated student", async () => {
    mockFetchStudentsPage.mockResolvedValue({
      items: [studentRecord({ status: "graduated" })],
      pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1 },
    });

    renderWithProviders(<StudentDirectoryTable />);

    await screen.findByText(/graduated/i);
    expect(screen.queryByRole("button", { name: /withdraw/i })).not.toBeInTheDocument();
  });

  it("shows the row-level Withdraw action for an active student (positive control)", async () => {
    mockFetchStudentsPage.mockResolvedValue({
      items: [studentRecord({ status: "active", first_name: "Ayesha" })],
      pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1 },
    });

    renderWithProviders(<StudentDirectoryTable />);

    expect(await screen.findByRole("button", { name: /^withdraw/i })).toBeInTheDocument();
  });

  it("shows a permission-denied message, not the generic one, for a 403", async () => {
    mockFetchStudentsPage.mockRejectedValue(
      new ApiError({
        code: "permission_denied",
        message: "Forbidden.",
        status: 403,
        url: "/students",
      }),
    );

    renderWithProviders(<StudentDirectoryTable />);

    expect(await screen.findByText(/don't have permission to view students/i)).toBeInTheDocument();
  });

  it("shows a generic failure message, not the permission one, for a network error", async () => {
    mockFetchStudentsPage.mockRejectedValue(
      new ApiError({ code: "network_error", message: "", status: 0, url: "/students" }),
    );

    renderWithProviders(<StudentDirectoryTable />);

    // The real `errors.network_error` string, not a guessed pattern (round-4 review
    // finding: an earlier version of this regex matched nothing in the real en.json).
    expect(await screen.findByText(/we could not reach the server/i)).toBeInTheDocument();
    expect(screen.queryByText(/don't have permission/i)).not.toBeInTheDocument();
  });

  it("shows the generic load-error message, not the permission one, for a thrown error that isn't an ApiError at all", async () => {
    // Distinct from the test above: that one throws an ApiError whose code just isn't
    // "permission_denied" — this one throws something that isn't an ApiError instance at
    // all (e.g. a raw TypeError from a bug elsewhere in the fetch chain), which
    // `resolveErrorMessage` can only handle via its `fallback` argument. Before this fix
    // that fallback was `t("list.forbidden")` for every non-ApiError failure, incorrectly
    // claiming a permission problem for any unrelated crash.
    mockFetchStudentsPage.mockRejectedValue(new TypeError("Cannot read properties of undefined"));

    renderWithProviders(<StudentDirectoryTable />);

    expect(await screen.findByText(/couldn't load the students list/i)).toBeInTheDocument();
    expect(screen.queryByText(/don't have permission/i)).not.toBeInTheDocument();
  });

  it("opens the edit form dialog, pre-targeted at that row's student, from the row's Edit action", async () => {
    mockFetchStudentsPage.mockResolvedValue({
      items: [studentRecord({ id: "stu-1", first_name: "Ayesha", last_name: "Khan" })],
      pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1 },
    });
    mockFetchStudentById.mockResolvedValue(studentRecord({ id: "stu-1" }));

    renderWithProviders(<StudentDirectoryTable />);

    await userEvent.setup().click(await screen.findByRole("button", { name: /edit ayesha khan/i }));

    expect(await screen.findByRole("heading", { name: /edit student/i })).toBeInTheDocument();
    expect(mockFetchStudentById).toHaveBeenCalledWith("stu-1");
  });

  it("opens the withdraw dialog for just that row's student from the row's Withdraw action", async () => {
    mockFetchStudentsPage.mockResolvedValue({
      items: [
        studentRecord({ id: "stu-1", first_name: "Ayesha", last_name: "Khan", status: "active" }),
      ],
      pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1 },
    });

    renderWithProviders(<StudentDirectoryTable />);

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: /^withdraw ayesha khan/i }));

    expect(await screen.findByText("Withdraw Ayesha Khan")).toBeInTheDocument();
  });

  it("opens the withdraw dialog for every selected active student via the bulk-withdraw button", async () => {
    mockFetchStudentsPage.mockResolvedValue({
      items: [
        studentRecord({ id: "stu-1", first_name: "Ayesha", last_name: "Khan", status: "active" }),
        studentRecord({ id: "stu-2", first_name: "Bilal", last_name: "Ahmed", status: "active" }),
      ],
      pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1 },
    });

    renderWithProviders(<StudentDirectoryTable />);
    const user = userEvent.setup();

    const rowCheckboxes = await screen.findAllByRole("checkbox", { name: /select this student/i });
    expect(rowCheckboxes).toHaveLength(2);
    await user.click(rowCheckboxes[0] as HTMLElement);
    await user.click(rowCheckboxes[1] as HTMLElement);

    await user.click(screen.getByRole("button", { name: /withdraw 2/i }));

    expect(await screen.findByText("Withdraw 2 students")).toBeInTheDocument();
  });

  it("offers no ID-card button without students.id-card.generate, even with rows selected", async () => {
    mockFetchStudentsPage.mockResolvedValue({
      items: [
        studentRecord({ id: "stu-1", first_name: "Ayesha", last_name: "Khan", status: "active" }),
        studentRecord({ id: "stu-2", first_name: "Bilal", last_name: "Ahmed", status: "active" }),
      ],
      pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1 },
    });

    renderWithProviders(<StudentDirectoryTable />);
    const user = userEvent.setup();

    // The Edit action renders only once the user's permissions have loaded, so past this
    // point a missing ID-card button can't just be the permissions still being fetched.
    await screen.findByRole("button", { name: /edit ayesha khan/i });
    const rowCheckboxes = await screen.findAllByRole("checkbox", { name: /select this student/i });
    await user.click(rowCheckboxes[0] as HTMLElement);
    await user.click(rowCheckboxes[1] as HTMLElement);

    // The bulk-withdraw button proves the selection took effect and the toolbar re-rendered.
    expect(await screen.findByRole("button", { name: "Withdraw 2" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /generate id cards/i })).not.toBeInTheDocument();
  });

  it("shows Generate ID cards (2) once two rows are selected, for a user who may generate", async () => {
    mockFetchCurrentUser.mockResolvedValue(ID_CARD_USER);
    mockFetchStudentsPage.mockResolvedValue({
      items: [
        studentRecord({ id: "stu-1", first_name: "Ayesha", last_name: "Khan", status: "active" }),
        studentRecord({ id: "stu-2", first_name: "Bilal", last_name: "Ahmed", status: "active" }),
      ],
      pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1 },
    });

    renderWithProviders(<StudentDirectoryTable />);
    const user = userEvent.setup();

    const rowCheckboxes = await screen.findAllByRole("checkbox", { name: /select this student/i });
    await user.click(rowCheckboxes[0] as HTMLElement);
    await user.click(rowCheckboxes[1] as HTMLElement);

    expect(await screen.findByRole("button", { name: "Generate ID cards (2)" })).toBeEnabled();
  });

  it("generates ID cards for every selected row, not just the active ones bulk withdraw acts on", async () => {
    mockFetchCurrentUser.mockResolvedValue(ID_CARD_USER);
    mockFetchStudentsPage.mockResolvedValue({
      items: [
        studentRecord({ id: "stu-1", first_name: "Ayesha", last_name: "Khan", status: "active" }),
        studentRecord({
          id: "stu-2",
          first_name: "Bilal",
          last_name: "Ahmed",
          status: "graduated",
        }),
      ],
      pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1 },
    });
    mockGenerateIdCards.mockResolvedValue({ jobId: "job-1" });
    const runningJob: BackgroundJobRecord = {
      id: "job-1",
      job_type: "id-cards.generate",
      status: "running",
      progress: 40,
      result: null,
      error: null,
    };
    mockFetchJob.mockResolvedValue(runningJob);

    renderWithProviders(<StudentDirectoryTable />);
    const user = userEvent.setup();

    const rowCheckboxes = await screen.findAllByRole("checkbox", { name: /select this student/i });
    await user.click(rowCheckboxes[0] as HTMLElement);
    await user.click(rowCheckboxes[1] as HTMLElement);

    // Only the active row is withdrawable; both rows get an ID card.
    expect(await screen.findByRole("button", { name: "Withdraw 1" })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Generate ID cards (2)" }));
    await waitFor(() => {
      expect(mockGenerateIdCards).toHaveBeenCalledWith(["stu-1", "stu-2"]);
    });

    // The job outlives the selection: clearing it must not unmount the progress button.
    expect(await screen.findByRole("button", { name: "Generating — 40%" })).toBeDisabled();
    for (const checkbox of screen.getAllByRole("checkbox", { name: /select this student/i })) {
      await user.click(checkbox);
    }
    expect(screen.getByRole("button", { name: "Generating — 40%" })).toBeDisabled();
  });
});
