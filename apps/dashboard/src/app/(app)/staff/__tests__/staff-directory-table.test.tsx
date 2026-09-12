import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { ApiError } from "@schoolhub/api-client";
import { Services } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { StaffDirectoryTable } from "../staff-directory-table";

// `StaffFormDialog` (Edit) and `ExitStaffDialog` (Delete / bulk Exit selected) both render
// from this table now, and each calls some of `fetchCampuses`/`fetchDepartments`/
// `fetchDesignations`/`fetchStaffDirectory` from their own gated (`enabled: open`)
// `useQuery` calls — never invoked until a dialog actually opens, but the mock object
// itself needs these present (resolved to empty arrays) or a test crashes with "not a
// function" the moment a dialog opens. `exitStaff` backs the Delete/"Exit selected" flow.
jest.mock("@/services", () => ({
  Services: {
    dashboard: {
      fetchStaffPage: jest.fn(),
      fetchCampuses: jest.fn().mockResolvedValue([]),
      fetchDepartments: jest.fn().mockResolvedValue([]),
      fetchDesignations: jest.fn().mockResolvedValue([]),
      fetchStaffDirectory: jest.fn().mockResolvedValue([]),
      exitStaff: jest.fn(),
    },
  },
}));

// `handleCopyId` (staff-directory-table.tsx) calls `toast.success(...)`/`toast.error(...)`
// directly (not `toast(...)`). `ExitStaffDialog`'s own `onSuccess` (rendered here via the
// bulk "Exit selected" flow) additionally calls `toast.warning(...)` on a mixed-outcome
// partial-failure batch — without a `warning` stub that call is `undefined(...)`, which
// throws synchronously inside the mutation's success handler and resets `mutation.data`
// before the failure list ever renders, silently breaking the partial-failure test below.
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

const mockFetchStaffPage = Services.dashboard.fetchStaffPage as jest.MockedFunction<
  typeof Services.dashboard.fetchStaffPage
>;
const mockExitStaff = Services.dashboard.exitStaff as jest.MockedFunction<
  typeof Services.dashboard.exitStaff
>;
const mockToastSuccess = toast.success as jest.MockedFunction<typeof toast.success>;
const mockToastError = toast.error as jest.MockedFunction<typeof toast.error>;

// jsdom (26.1.0, confirmed by grepping its lib for "clipboard") implements no Clipboard
// API at all, so `navigator.clipboard` is `undefined` by default — `useCopyToClipboard`
// reads `navigator.clipboard.writeText` unconditionally, which throws without this.
// Defined once at module scope (not per-test): jsdom's `navigator` has no pre-existing
// `clipboard` descriptor to fight, and `clearMocks` in jest.config.ts already resets
// `mockWriteText`'s call history before every test.
const mockWriteText = jest.fn().mockResolvedValue(undefined);
Object.defineProperty(navigator, "clipboard", {
  value: { writeText: mockWriteText },
  writable: true,
  configurable: true,
});

/**
 * Disambiguates a popover's own trigger button from a same-named sortable column
 * header button — both can share an identical accessible name (the Status popover
 * trigger and the "Status" column's own sort-toggle button both compute to just
 * "Status", since `DataGridColumnHeader` is called with `title="Status"` and no
 * `icon`, whose only other content is an `aria-hidden` sort-direction icon). Only the
 * popover trigger carries `aria-haspopup="dialog"` (confirmed directly against
 * `@radix-ui/react-popover`'s `PopoverTrigger` source); the column header's sort
 * button, wrapped in a `DropdownMenuTrigger asChild` whenever the table is
 * pinnable/movable/hideable (as this one is), instead carries `aria-haspopup="menu"`
 * (confirmed against `@radix-ui/react-dropdown-menu`'s own `DropdownMenuTrigger`).
 */
function popoverTrigger(label: string) {
  return (accessibleName: string, element: Element) =>
    accessibleName === label && element.getAttribute("aria-haspopup") === "dialog";
}

function staffRecord() {
  return {
    id: "st-1",
    first_name: "Ayesha",
    last_name: "Khan",
    designation_name: "Head Teacher",
    department_name: "Academics",
    campus_name: "Main Campus",
    staff_type: "teaching" as const,
    employment_status: "active",
    updated_at: "2026-09-01T00:00:00Z",
  };
}

/** A second, distinctly-id'd/named fixture — used by the bulk-selection tests, which
 * need 2+ rows to check. */
function secondStaffRecord() {
  return {
    id: "st-2",
    first_name: "Bilal",
    last_name: "Ahmed",
    designation_name: "Lab Assistant",
    department_name: "Science",
    campus_name: "Main Campus",
    staff_type: "non_teaching" as const,
    employment_status: "active",
    updated_at: "2026-09-01T00:00:00Z",
  };
}

describe("StaffDirectoryTable", () => {
  beforeEach(() => {
    mockFetchStaffPage.mockReset();
    mockExitStaff.mockReset();
  });

  it("renders a page of staff: name, role, status badge, campus, and initials (never a photo)", async () => {
    mockFetchStaffPage.mockResolvedValue({
      items: [staffRecord()],
      pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1 },
    });

    renderWithProviders(<StaffDirectoryTable />);

    expect(await screen.findByText("Ayesha Khan")).toBeInTheDocument();
    expect(screen.getByText("Head Teacher")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Main Campus")).toBeInTheDocument();

    // No `AvatarImage`/`src` is ever rendered — `StaffSerializer.photo_file_id` has no
    // resolvable URL anywhere in the API today, so the Member cell shows initials only.
    const row = screen.getByText("Ayesha Khan").closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).queryByRole("img")).not.toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("AK")).toBeInTheDocument();
  });

  it("shows the empty state when the directory has no staff", async () => {
    mockFetchStaffPage.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 10, total_count: 0, total_pages: 1 },
    });

    renderWithProviders(<StaffDirectoryTable />);

    expect(await screen.findByText("No staff found")).toBeInTheDocument();
  });

  it("shows a generic error message when the directory fails to load", async () => {
    mockFetchStaffPage.mockRejectedValue(new Error("network error"));

    renderWithProviders(<StaffDirectoryTable />);

    expect(await screen.findByText(/couldn.t load the staff directory/i)).toBeInTheDocument();
  });

  it("shows a permission-denied message on a 403, distinct from the generic error", async () => {
    mockFetchStaffPage.mockRejectedValue(
      new ApiError({ code: "permission_denied", message: "Forbidden", status: 403, url: "/staff" }),
    );

    renderWithProviders(<StaffDirectoryTable />);

    expect(
      await screen.findByText(/you don.t have access to the staff directory/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/couldn.t load the staff directory/i)).not.toBeInTheDocument();
  });

  it("re-fetches with a search query after the user types, debounced", async () => {
    mockFetchStaffPage.mockResolvedValue({
      items: [staffRecord()],
      pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1 },
    });

    renderWithProviders(<StaffDirectoryTable />);
    await screen.findByText("Ayesha Khan");
    mockFetchStaffPage.mockClear();

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Search staff..."), "khan");

    await waitFor(() => {
      expect(mockFetchStaffPage).toHaveBeenCalledWith(
        expect.objectContaining({ search: "khan", page: 1 }),
      );
    });
  });

  it("sorts by the clicked column header, ascending then descending", async () => {
    mockFetchStaffPage.mockResolvedValue({
      items: [staffRecord()],
      pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1 },
    });

    renderWithProviders(<StaffDirectoryTable />);
    await screen.findByText("Ayesha Khan");
    mockFetchStaffPage.mockClear();

    const user = userEvent.setup();
    // "Role" (SORT_FIELD.role -> "designation_name") starts unsorted, unlike "Member"
    // which is the table's own default sort — a fresh column exercises the plain
    // unsorted -> ascending -> descending cycle without a pre-existing sort to account for.
    await user.click(screen.getByRole("button", { name: "Role" }));

    await waitFor(() => {
      expect(mockFetchStaffPage).toHaveBeenCalledWith(
        expect.objectContaining({ ordering: "designation_name" }),
      );
    });

    await user.click(screen.getByRole("button", { name: "Role" }));

    await waitFor(() => {
      expect(mockFetchStaffPage).toHaveBeenCalledWith(
        expect.objectContaining({ ordering: "-designation_name" }),
      );
    });
  });

  it("requests the next page when the pagination control is clicked", async () => {
    mockFetchStaffPage.mockResolvedValue({
      items: [staffRecord()],
      pagination: { page: 1, page_size: 10, total_count: 15, total_pages: 2 },
    });

    renderWithProviders(<StaffDirectoryTable />);
    await screen.findByText("Ayesha Khan");
    mockFetchStaffPage.mockClear();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() => {
      expect(mockFetchStaffPage).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
    });
  });

  it("Status popover: selecting a status filters by employmentStatus; selecting it again clears it", async () => {
    mockFetchStaffPage.mockResolvedValue({
      items: [staffRecord()],
      pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1 },
    });

    renderWithProviders(<StaffDirectoryTable />);
    await screen.findByText("Ayesha Khan");
    mockFetchStaffPage.mockClear();

    const user = userEvent.setup();
    // Plain `{ name: "Status" }` is ambiguous here: the "Status" table column's own
    // sortable header button computes to the identical accessible name "Status" — see
    // `popoverTrigger`'s doc comment above.
    await user.click(screen.getByRole("button", { name: popoverTrigger("Status") }));

    // "Active" starts checked — it's the same state the "Active Users" toggle defaults
    // on, so the popover opens already reflecting that. Clicking it clears the filter.
    await user.click(screen.getByRole("checkbox", { name: "Active" }));

    await waitFor(() => {
      expect(mockFetchStaffPage).toHaveBeenCalledWith(
        expect.objectContaining({ employmentStatus: undefined }),
      );
    });

    // `StaffFilterSet.employment_status` is a plain exact-match filter, single value at
    // a time — selecting a different status swaps the filter to that one value.
    await user.click(screen.getByRole("checkbox", { name: "On leave" }));

    await waitFor(() => {
      expect(mockFetchStaffPage).toHaveBeenCalledWith(
        expect.objectContaining({ employmentStatus: "on_leave" }),
      );
    });
  });

  it('"Active Users" toggle is the same state as the Status popover\'s "Active" checkbox', async () => {
    mockFetchStaffPage.mockResolvedValue({
      items: [staffRecord()],
      pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1 },
    });

    renderWithProviders(<StaffDirectoryTable />);
    await screen.findByText("Ayesha Khan");

    // Defaults on — the very first fetch already filtered to active staff.
    expect(mockFetchStaffPage).toHaveBeenCalledWith(
      expect.objectContaining({ employmentStatus: "active" }),
    );
    expect(screen.getByRole("switch", { name: "Active Users" })).toBeChecked();

    mockFetchStaffPage.mockClear();
    const user = userEvent.setup();
    await user.click(screen.getByRole("switch", { name: "Active Users" }));

    await waitFor(() => {
      expect(mockFetchStaffPage).toHaveBeenCalledWith(
        expect.objectContaining({ employmentStatus: undefined }),
      );
    });
  });

  it("Sort Order popover: Newest joiners sorts -joining_date, Oldest joiners sorts joining_date", async () => {
    mockFetchStaffPage.mockResolvedValue({
      items: [staffRecord()],
      pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1 },
    });

    renderWithProviders(<StaffDirectoryTable />);
    await screen.findByText("Ayesha Khan");
    mockFetchStaffPage.mockClear();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Sort Order" }));
    await user.click(screen.getByRole("checkbox", { name: "Newest joiners" }));

    await waitFor(() => {
      expect(mockFetchStaffPage).toHaveBeenCalledWith(
        expect.objectContaining({ ordering: "-joining_date" }),
      );
    });

    await user.click(screen.getByRole("checkbox", { name: "Oldest joiners" }));

    await waitFor(() => {
      expect(mockFetchStaffPage).toHaveBeenCalledWith(
        expect.objectContaining({ ordering: "joining_date" }),
      );
    });
  });

  it("Sort Order popover: selecting the active preset again resets to the default name sort", async () => {
    mockFetchStaffPage.mockResolvedValue({
      items: [staffRecord()],
      pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1 },
    });

    renderWithProviders(<StaffDirectoryTable />);
    await screen.findByText("Ayesha Khan");
    mockFetchStaffPage.mockClear();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Sort Order" }));
    await user.click(screen.getByRole("checkbox", { name: "Newest joiners" }));

    await waitFor(() => {
      expect(mockFetchStaffPage).toHaveBeenCalledWith(
        expect.objectContaining({ ordering: "-joining_date" }),
      );
    });

    // Same "select again to clear" behaviour as the Status popover — resets `sorting`
    // back to DEFAULT_SORTING (name, ascending -> "last_name"), not to no sort at all.
    await user.click(screen.getByRole("checkbox", { name: "Newest joiners" }));

    await waitFor(() => {
      expect(mockFetchStaffPage).toHaveBeenCalledWith(
        expect.objectContaining({ ordering: "last_name" }),
      );
    });
  });

  it("clicking a column header after a Sort Order preset silently overwrites the preset", async () => {
    mockFetchStaffPage.mockResolvedValue({
      items: [staffRecord()],
      pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1 },
    });

    renderWithProviders(<StaffDirectoryTable />);
    await screen.findByText("Ayesha Khan");
    mockFetchStaffPage.mockClear();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Sort Order" }));
    await user.click(screen.getByRole("checkbox", { name: "Newest joiners" }));

    await waitFor(() => {
      expect(mockFetchStaffPage).toHaveBeenCalledWith(
        expect.objectContaining({ ordering: "-joining_date" }),
      );
    });

    // The Sort Order popover and column-header sorting share one `sorting` state slot
    // (see the component's own comment on `handleSortOrderToggle`) — clicking a real
    // column header overwrites the `joiningDate` sentinel entirely rather than composing
    // with it.
    await user.click(screen.getByRole("button", { name: "Campus" }));

    await waitFor(() => {
      expect(mockFetchStaffPage).toHaveBeenCalledWith(
        expect.objectContaining({ ordering: "campus_name" }),
      );
    });

    // The preset is gone, not just superseded in the query: the trigger's badge (and so
    // its accessible name) reverts to the bare "Sort Order" label.
    expect(screen.getByRole("button", { name: "Sort Order" })).toBeInTheDocument();
  });

  it("Copy ID copies the row's real id and confirms with a toast once the write resolves", async () => {
    mockFetchStaffPage.mockResolvedValue({
      items: [staffRecord()],
      pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1 },
    });

    renderWithProviders(<StaffDirectoryTable />);
    await screen.findByText("Ayesha Khan");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Actions for Ayesha Khan" }));
    await user.click(screen.getByRole("menuitem", { name: "Copy ID" }));

    expect(mockWriteText).toHaveBeenCalledWith("st-1");

    // `handleCopyId` now awaits `copyToClipboard`'s returned promise before toasting
    // (see staff-directory-table.tsx and use-copy-to-clipboard.ts), so the success
    // toast lands after the write resolves, not synchronously with the click.
    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith("Staff ID copied");
    });
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("Copy ID shows a distinct failure toast when the clipboard write fails, never a false success", async () => {
    mockFetchStaffPage.mockResolvedValue({
      items: [staffRecord()],
      pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1 },
    });
    mockWriteText.mockRejectedValueOnce(new Error("denied"));

    renderWithProviders(<StaffDirectoryTable />);
    await screen.findByText("Ayesha Khan");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Actions for Ayesha Khan" }));
    await user.click(screen.getByRole("menuitem", { name: "Copy ID" }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("Couldn't copy staff ID");
    });
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it("Edit opens the staff form dialog in edit mode for that row", async () => {
    mockFetchStaffPage.mockResolvedValue({
      items: [staffRecord()],
      pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1 },
    });

    renderWithProviders(<StaffDirectoryTable />);
    await screen.findByText("Ayesha Khan");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Actions for Ayesha Khan" }));

    const editItem = screen.getByRole("menuitem", { name: "Edit" });
    expect(editItem).not.toHaveAttribute("aria-disabled", "true");

    await user.click(editItem);

    expect(await screen.findByRole("heading", { name: "Edit staff member" })).toBeInTheDocument();
  });

  it("Delete opens the exit staff dialog for that single row", async () => {
    mockFetchStaffPage.mockResolvedValue({
      items: [staffRecord()],
      pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1 },
    });

    renderWithProviders(<StaffDirectoryTable />);
    await screen.findByText("Ayesha Khan");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Actions for Ayesha Khan" }));

    const deleteItem = screen.getByRole("menuitem", { name: "Delete" });
    expect(deleteItem).not.toHaveAttribute("aria-disabled", "true");

    await user.click(deleteItem);

    expect(await screen.findByRole("heading", { name: "Exit staff member" })).toBeInTheDocument();
  });

  it('the bulk "Exit selected" button is absent with no selection, and appears with the right count once a row is checked', async () => {
    mockFetchStaffPage.mockResolvedValue({
      items: [staffRecord(), secondStaffRecord()],
      pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1 },
    });

    renderWithProviders(<StaffDirectoryTable />);
    await screen.findByText("Ayesha Khan");
    await screen.findByText("Bilal Ahmed");

    expect(screen.queryByRole("button", { name: /Exit selected/i })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "Select Ayesha Khan" }));

    expect(
      await screen.findByRole("button", { name: "Exit selected (1)" }),
    ).toBeInTheDocument();
  });

  it("clicking the bulk button opens ExitStaffDialog with every selected id/name, correctly paired even when rows are checked out of order", async () => {
    mockFetchStaffPage.mockResolvedValue({
      items: [staffRecord(), secondStaffRecord()],
      pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1 },
    });
    // "st-2" (Bilal Ahmed) fails, "st-1" (Ayesha Khan) succeeds — if the failure list's
    // id/name pairing were ever wrong, this would surface as the WRONG name shown next to
    // the failure message.
    mockExitStaff.mockImplementation((id: string) =>
      id === "st-1"
        ? Promise.resolve({ ...staffRecord(), employment_status: "resigned" })
        : Promise.reject(
            new ApiError({
              code: "domain_rule_violation",
              message: "This staff member has already exited",
              status: 409,
              url: "/staff/st-2:exit",
            }),
          ),
    );

    renderWithProviders(<StaffDirectoryTable />);
    await screen.findByText("Ayesha Khan");
    await screen.findByText("Bilal Ahmed");

    const user = userEvent.setup();
    // Non-sequential order: the second row is checked before the first.
    await user.click(screen.getByRole("checkbox", { name: "Select Bilal Ahmed" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Ayesha Khan" }));

    await user.click(screen.getByRole("button", { name: "Exit selected (2)" }));

    expect(
      await screen.findByRole("heading", { name: "Exit 2 staff members" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^exit date$/i), {
      target: { value: "2026-09-10" },
    });
    await user.type(screen.getByLabelText(/^exit reason$/i), "Bulk exit test");
    await user.click(screen.getByRole("button", { name: /^exit staff members$/i }));

    await waitFor(() => {
      expect(mockExitStaff).toHaveBeenCalledTimes(2);
    });
    // The right name shows up next to the failing id — proves selectedIds/selectedNames
    // stayed paired by row, not by click sequence.
    expect(await screen.findByText(/Bilal Ahmed — This staff member has already exited/)).toBeInTheDocument();
    expect(screen.queryByText(/Ayesha Khan — /)).not.toBeInTheDocument();
  });

  it("clears the row selection once the exit dialog closes on genuine success", async () => {
    mockFetchStaffPage.mockResolvedValue({
      items: [staffRecord(), secondStaffRecord()],
      pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1 },
    });
    mockExitStaff.mockResolvedValue({ ...staffRecord(), employment_status: "resigned" });

    renderWithProviders(<StaffDirectoryTable />);
    await screen.findByText("Ayesha Khan");
    await screen.findByText("Bilal Ahmed");

    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "Select Ayesha Khan" }));
    await user.click(await screen.findByRole("button", { name: "Exit selected (1)" }));

    expect(await screen.findByRole("heading", { name: "Exit staff member" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^exit date$/i), {
      target: { value: "2026-09-10" },
    });
    await user.type(screen.getByLabelText(/^exit reason$/i), "Resigned voluntarily");
    await user.click(screen.getByRole("button", { name: /^exit staff member$/i }));

    // The dialog closing on genuine success is what triggers the selection clear (see
    // staff-directory-table.tsx's `previousExitDialogRef` effect) — asserting the bulk
    // button is gone again is the more direct signal than re-querying the row's own
    // checkbox, since the button's presence is itself derived straight from
    // `selectedIds.length`.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Exit selected/i })).not.toBeInTheDocument();
    });
  });
});
