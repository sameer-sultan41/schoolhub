import type { AuthenticatedUser } from "@schoolhub/types";
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

interface MockCurrentUserResult {
  data: AuthenticatedUser | undefined;
  isError: boolean;
}
const mockUseCurrentUser = jest.fn<MockCurrentUserResult, []>();
jest.mock("@/hooks/use-current-user", () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}));

const mockFetchStudentsPage = Services.students.fetchStudentsPage as jest.MockedFunction<
  typeof Services.students.fetchStudentsPage
>;

const PERMITTED_USER: AuthenticatedUser = {
  id: "u1",
  email: "records@example.com",
  phone: null,
  full_name: "Records Manager",
  avatar_url: null,
  locale: "en",
  tenant_id: "tenant-1",
  roles: [],
  permissions: ["students.student.view", "students.student.create"],
};

describe("StudentToolbar", () => {
  beforeEach(() => {
    mockFetchStudentsPage.mockReset();
    mockUseCurrentUser.mockReset().mockReturnValue({ data: PERMITTED_USER, isError: false });
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

  it("shows unavailable, not a stale figure, when a stat query fails", async () => {
    mockFetchStudentsPage.mockRejectedValue(new Error("network down"));

    renderWithProviders(<StudentToolbar />);

    expect(await screen.findAllByText("—")).toHaveLength(2);
  });

  it("explains via the New-student button's title why it's disabled when permissions failed to load", async () => {
    mockUseCurrentUser.mockReturnValue({ data: undefined, isError: true });
    mockFetchStudentsPage.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 1, total_count: 0, total_pages: 0 },
    });

    renderWithProviders(<StudentToolbar />);

    const button = await screen.findByRole("button", { name: /new student/i });
    expect(button).toBeDisabled();
    expect(button.closest("span")).toHaveAttribute("title", expect.stringMatching(/permission/i));
  });
});
