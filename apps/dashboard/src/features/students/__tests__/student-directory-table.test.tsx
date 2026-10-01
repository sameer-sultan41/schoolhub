import { ApiError } from "@schoolhub/api-client";
import type { AuthenticatedUser } from "@schoolhub/types";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import type { StudentRecord } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { StudentDirectoryTable } from "../student-directory-table";

// `StudentFormDialog`, `StudentDetailSheet` and `WithdrawStudentDialog` all render from
// this table and each fires its own (`enabled`-gated, in the detail sheet's and form
// dialog's case) queries/mutations the instant they're opened — the mock object itself
// needs every one of these present (resolved to a sane default) or a test crashes with
// "not a function" the moment a dialog opens, same reasoning as
// `staff-directory-table.test.tsx`'s own mock.
jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    auth: { fetchCurrentUser: jest.fn() },
    students: {
      fetchStudentsPage: jest.fn(),
      fetchStudentById: jest.fn(),
      withdrawStudent: jest.fn(),
    },
    dashboard: { fetchCampuses: jest.fn().mockResolvedValue([]) },
    schoolOrganization: { fetchHouses: jest.fn().mockResolvedValue([]) },
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
});
