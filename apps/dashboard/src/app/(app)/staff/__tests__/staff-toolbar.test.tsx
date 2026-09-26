import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { StaffToolbar } from "../staff-toolbar";

// `ToolbarHeading` (used inside `StaffToolbar` via `Toolbar`) calls `usePathname()` to
// resolve the page title from `menu-config.ts` — outside a real Next.js App Router tree
// `usePathname()` has no route to read, and `useMenu`'s own `isActive` unconditionally
// calls `pathname.startsWith(...)`, which throws on a nullish pathname. A fixed pathname
// is enough; this test asserts on the stat line, not the resolved title.
jest.mock("next/navigation", () => ({
  usePathname: () => "/staff",
}));

// `StaffFormDialog` renders once "Add Member" is clicked and calls `fetchCampuses`/
// `fetchDepartments`/`fetchDesignations`/`fetchStaffDirectory` from its own gated
// (`enabled: open`) `useQuery` calls — never invoked until the dialog actually opens,
// but the mock object itself needs these four functions present (resolved to empty
// arrays) or the test crashes with "not a function" the moment the dialog opens.
jest.mock("@/services", () => ({
  Services: {
    dashboard: {
      fetchStaffPage: jest.fn(),
      fetchStaffTypeCount: jest.fn(),
      fetchCampuses: jest.fn().mockResolvedValue([]),
      fetchDepartments: jest.fn().mockResolvedValue([]),
      fetchDesignations: jest.fn().mockResolvedValue([]),
      fetchStaffDirectory: jest.fn().mockResolvedValue([]),
    },
  },
}));

const mockFetchStaffPage = Services.dashboard.fetchStaffPage as jest.MockedFunction<
  typeof Services.dashboard.fetchStaffPage
>;
const mockFetchStaffTypeCount = Services.dashboard.fetchStaffTypeCount as jest.MockedFunction<
  typeof Services.dashboard.fetchStaffTypeCount
>;

describe("StaffToolbar", () => {
  beforeEach(() => {
    mockFetchStaffPage.mockReset();
    mockFetchStaffTypeCount.mockReset();
  });

  it('shows "—" for both stats while the underlying queries are pending', () => {
    // Never resolves — both queries stay pending for the life of this test, which is
    // exactly the state under assertion.
    mockFetchStaffPage.mockReturnValue(new Promise(() => {}));
    mockFetchStaffTypeCount.mockReturnValue(new Promise(() => {}));

    renderWithProviders(<StaffToolbar />);

    expect(screen.getByText("All Members:")).toBeInTheDocument();
    expect(screen.getByText("Teaching Staff:")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it('shows "—", never a fabricated "0", when total_count/count are absent from the responses', async () => {
    // A `CursorPagination`-shaped meta (`total_count` optional and, here, omitted) —
    // legitimately "no total is reported here" per that field's own contract, distinct
    // from a reported `0`. `fetchStaffTypeCount` resolving `null` is its own documented
    // "didn't report a total" case (dashboard-service.ts).
    mockFetchStaffPage.mockResolvedValue({
      items: [],
      pagination: { next_cursor: null, previous_cursor: null, page_size: 1 },
    });
    mockFetchStaffTypeCount.mockResolvedValue(null);

    renderWithProviders(<StaffToolbar />);

    await waitFor(() => {
      expect(screen.getAllByText("—")).toHaveLength(2);
    });
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("shows the real numbers once both queries resolve with genuine counts", async () => {
    mockFetchStaffPage.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 1, total_count: 254, total_pages: 254 },
    });
    mockFetchStaffTypeCount.mockResolvedValue(128);

    renderWithProviders(<StaffToolbar />);

    expect(await screen.findByText("254")).toBeInTheDocument();
    expect(screen.getByText("128")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it('"Add Member" opens the staff form dialog in create mode', async () => {
    mockFetchStaffPage.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 1, total_count: 0, total_pages: 0 },
    });
    mockFetchStaffTypeCount.mockResolvedValue(0);

    renderWithProviders(<StaffToolbar />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add Member" }));

    expect(await screen.findByRole("heading", { name: "Add staff member" })).toBeInTheDocument();
  });
});
