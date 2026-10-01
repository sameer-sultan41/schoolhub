import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { StudentToolbar } from "../student-toolbar";

// `ToolbarHeading` (used inside `StudentToolbar` via `Toolbar`) calls `usePathname()` to
// resolve the page title from `menu-config.ts` — outside a real Next.js App Router tree
// `usePathname()` has no route to read, and `useMenu`'s own `isActive` unconditionally
// calls `pathname.startsWith(...)`, which throws on a nullish pathname. Matches
// `staff-toolbar.test.tsx`'s own identical mock.
jest.mock("next/navigation", () => ({ usePathname: () => "/students" }));

jest.mock("@/services", () => ({
  Services: {
    students: { fetchStudentsPage: jest.fn() },
    dashboard: { fetchCampuses: jest.fn().mockResolvedValue([]) },
    schoolOrganization: { fetchHouses: jest.fn().mockResolvedValue([]) },
  },
  // The real class: `StudentFormDialog` `instanceof`-checks it.
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
}));

jest.mock("@/hooks/use-current-user", () => ({
  useCurrentUser: () => ({
    data: { id: "u1", permissions: ["students.student.view", "students.student.create"] },
    isError: false,
  }),
}));

const mockFetchStudentsPage = Services.students.fetchStudentsPage as jest.MockedFunction<
  typeof Services.students.fetchStudentsPage
>;

describe("StudentToolbar", () => {
  beforeEach(() => {
    mockFetchStudentsPage.mockReset();
  });

  it("shows the total and active counts as two distinct figures", async () => {
    mockFetchStudentsPage.mockImplementation((q) =>
      Promise.resolve({
        items: [],
        pagination: {
          page: 1,
          page_size: 1,
          total_count: q.status === "active" ? 190 : 214,
          total_pages: 1,
        },
      }),
    );

    renderWithProviders(<StudentToolbar />);

    await waitFor(() => {
      expect(screen.getByText("214")).toBeInTheDocument();
    });
    expect(screen.getByText("190")).toBeInTheDocument();
  });

  it("opens the create-student dialog when New student is clicked", async () => {
    mockFetchStudentsPage.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 1, total_count: 0, total_pages: 0 },
    });

    renderWithProviders(<StudentToolbar />);

    await userEvent.setup().click(await screen.findByRole("button", { name: /new student/i }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
