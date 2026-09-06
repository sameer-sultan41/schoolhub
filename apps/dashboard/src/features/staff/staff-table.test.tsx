import { ApiError, type ApiResult } from "@schoolhub/api-client";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StaffTable } from "@/features/staff/staff-table";
import { usePermission } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";
import { offsetPage, renderWithProviders } from "@/test-utils";

jest.mock("@/lib/auth", () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
// StaffTable never calls useSession itself — it renders <Can>, which reads
// usePermission/useAnyPermission — so those two are the ones to mock,
// mirroring students-table.test.tsx's identical comment.
jest.mock("@/hooks/use-session", () => ({
  usePermission: jest.fn(() => false),
  useAnyPermission: jest.fn(() => false),
}));
jest.mock("@/features/students/use-reference-data", () => ({
  useCampuses: () => ({ data: [{ id: "c1", name: "Main Campus", code: "MAIN" }] }),
}));
jest.mock("@/features/staff/use-designations", () => ({
  useDesignations: () => ({
    data: [
      {
        id: "d1",
        name: "Senior Teacher",
        code: "SR-TCH",
        description: null,
        level: 2,
        is_active: true,
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:00:00Z",
      },
    ],
  }),
}));
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
}));

// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockUsePermission = usePermission as jest.MockedFunction<typeof usePermission>;

const STAFF_MEMBER = {
  id: "st1",
  employee_number: "EMP-0001",
  first_name: "Bilal",
  last_name: "Ahmed",
  staff_type: "teaching",
  employment_status: "active",
  joining_date: "2024-08-01",
  email: "bilal.ahmed@demo.localhost",
  // The list serializer sends these beside their ids so the directory can name a
  // campus, a department and a designation without three lookup requests. Department
  // is null here on purpose — it is optional on a staff record, and the dash is what
  // the cell must render for it.
  campus_name: "Main Campus",
  department_name: null,
  designation_name: "Senior Teacher",
};

function mockStaffAndDepartments(staffPage: ApiResult<unknown>) {
  mockGet.mockImplementation((path: string) => {
    if (path === "/staff") return Promise.resolve(staffPage);
    if (path === "/departments") {
      return Promise.resolve(offsetPage([], {}, "req-departments"));
    }
    throw new Error(`unexpected path ${path}`);
  });
}

describe("StaffTable", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPush.mockReset();
    mockUsePermission.mockReturnValue(false);
  });

  it("shows skeleton rows while loading", () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<StaffTable />);

    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
  });

  it("renders rows once data resolves", async () => {
    mockStaffAndDepartments(offsetPage([STAFF_MEMBER], {}, "req-list"));

    renderWithProviders(<StaffTable />);

    expect(await screen.findByText("EMP-0001")).toBeInTheDocument();
    expect(screen.getByText("Bilal Ahmed")).toBeInTheDocument();
  });

  it("shows the translated empty state when the result set is empty", async () => {
    mockStaffAndDepartments(offsetPage([], {}, "req-list"));

    renderWithProviders(<StaffTable />);

    expect(await screen.findByText("No staff yet")).toBeInTheDocument();
  });

  it("renders the ApiError envelope on a request failure", async () => {
    mockGet.mockRejectedValue(
      new ApiError({
        code: "server_error",
        message: "boom",
        status: 500,
        url: "/staff",
        requestId: "req-1",
      }),
    );

    renderWithProviders(<StaffTable />);

    expect(await screen.findByText(/went wrong on our side/i)).toBeInTheDocument();
    expect(screen.getByText(/Reference: req-1/)).toBeInTheDocument();
  });

  it("clicking a row navigates to that staff member's detail page", async () => {
    mockStaffAndDepartments(offsetPage([STAFF_MEMBER], {}, "req-list"));

    renderWithProviders(<StaffTable />);

    const cell = await screen.findByText("Bilal Ahmed");
    fireEvent.click(cell.closest("tr") as HTMLElement);

    expect(mockPush).toHaveBeenCalledWith("/staff/st1");
  });

  it("clicking a page number asks the server for that page", async () => {
    // Two pages' worth: the pager only renders numbers when there is somewhere to go.
    mockStaffAndDepartments(
      offsetPage([STAFF_MEMBER], { total_count: 30, page_size: 25 }, "req-list"),
    );

    renderWithProviders(<StaffTable />);
    await screen.findByText("EMP-0001");

    fireEvent.click(screen.getByRole("button", { name: "Go to page 2" }));

    await waitFor(() => {
      const staffCalls = mockGet.mock.calls.filter((call) => call[0] === "/staff");
      expect(staffCalls.at(-1)?.[1]?.query?.page).toBe(2);
    });
  });

  it("debounces the search input before it reaches the query", async () => {
    jest.useFakeTimers();
    mockStaffAndDepartments(offsetPage([STAFF_MEMBER], {}, "req-list"));

    renderWithProviders(<StaffTable />);
    await screen.findByText("EMP-0001");
    const staffCallsBeforeTyping = mockGet.mock.calls.filter((call) => call[0] === "/staff").length;

    const searchInput = screen.getByLabelText("Search");
    fireEvent.change(searchInput, { target: { value: "Bi" } });
    fireEvent.change(searchInput, { target: { value: "Bilal" } });
    expect(searchInput).toHaveValue("Bilal");

    expect(mockGet.mock.calls.filter((call) => call[0] === "/staff").length).toBe(
      staffCallsBeforeTyping,
    );

    act(() => {
      jest.advanceTimersByTime(300);
    });
    jest.useRealTimers();

    await waitFor(() => {
      const staffCalls = mockGet.mock.calls.filter((call) => call[0] === "/staff");
      const lastCall = staffCalls.at(-1)?.[1];
      expect(lastCall?.query?.search).toBe("Bilal");
    });
  });

  it("changing the staff-type filter re-fetches with the selected type", async () => {
    mockStaffAndDepartments(offsetPage([STAFF_MEMBER], {}, "req-list"));

    const user = userEvent.setup();
    renderWithProviders(<StaffTable />);
    await screen.findByText("EMP-0001");

    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(await screen.findByRole("option", { name: "Non-teaching" }));

    await waitFor(() => {
      const staffCalls = mockGet.mock.calls.filter((call) => call[0] === "/staff");
      const lastCall = staffCalls.at(-1)?.[1];
      expect(lastCall?.query?.staff_type).toBe("non_teaching");
    });
  });

  it("changing the campus filter re-fetches with the selected campus", async () => {
    mockStaffAndDepartments(offsetPage([STAFF_MEMBER], {}, "req-list"));

    const user = userEvent.setup();
    renderWithProviders(<StaffTable />);
    await screen.findByText("EMP-0001");

    await user.click(screen.getByRole("combobox", { name: "Campus" }));
    await user.click(await screen.findByRole("option", { name: "Main Campus" }));

    await waitFor(() => {
      const staffCalls = mockGet.mock.calls.filter((call) => call[0] === "/staff");
      const lastCall = staffCalls.at(-1)?.[1];
      expect(lastCall?.query?.campus_id).toBe("c1");
    });
  });

  it("changing the department filter re-fetches with the selected department", async () => {
    mockGet.mockImplementation((path: string) => {
      if (path === "/staff") {
        return Promise.resolve(offsetPage([STAFF_MEMBER], {}, "req-list"));
      }
      if (path === "/departments") {
        return Promise.resolve(
          offsetPage([{ id: "dpt1", name: "Mathematics" }], {}, "req-departments"),
        );
      }
      throw new Error(`unexpected path ${path}`);
    });

    const user = userEvent.setup();
    renderWithProviders(<StaffTable />);
    await screen.findByText("EMP-0001");

    await user.click(screen.getByRole("combobox", { name: "Department" }));
    await user.click(await screen.findByRole("option", { name: "Mathematics" }));

    await waitFor(() => {
      const staffCalls = mockGet.mock.calls.filter((call) => call[0] === "/staff");
      const lastCall = staffCalls.at(-1)?.[1];
      expect(lastCall?.query?.department_id).toBe("dpt1");
    });
  });

  it("changing the employment-status filter re-fetches with the selected status", async () => {
    mockStaffAndDepartments(offsetPage([STAFF_MEMBER], {}, "req-list"));

    const user = userEvent.setup();
    renderWithProviders(<StaffTable />);
    await screen.findByText("EMP-0001");

    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByRole("option", { name: "On leave" }));

    await waitFor(() => {
      const staffCalls = mockGet.mock.calls.filter((call) => call[0] === "/staff");
      const lastCall = staffCalls.at(-1)?.[1];
      expect(lastCall?.query?.employment_status).toBe("on_leave");
    });
  });

  it("changing the designation filter re-fetches with the selected designation", async () => {
    mockStaffAndDepartments(offsetPage([STAFF_MEMBER], {}, "req-list"));

    const user = userEvent.setup();
    renderWithProviders(<StaffTable />);
    await screen.findByText("EMP-0001");

    await user.click(screen.getByRole("combobox", { name: "Designation" }));
    await user.click(await screen.findByRole("option", { name: "Senior Teacher" }));

    await waitFor(() => {
      const staffCalls = mockGet.mock.calls.filter((call) => call[0] === "/staff");
      const lastCall = staffCalls.at(-1)?.[1];
      expect(lastCall?.query?.designation_id).toBe("d1");
    });
  });

  it("Previous returns to the page before, and is disabled on the first", async () => {
    mockStaffAndDepartments(
      offsetPage([STAFF_MEMBER], { total_count: 30, page_size: 25 }, "req-list"),
    );

    renderWithProviders(<StaffTable />);
    await screen.findByText("EMP-0001");

    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Go to page 2" }));
    await waitFor(() => {
      const staffCalls = mockGet.mock.calls.filter((call) => call[0] === "/staff");
      expect(staffCalls.at(-1)?.[1]?.query?.page).toBe(2);
    });

    const previous = screen.getByRole("button", { name: "Previous page" });
    await waitFor(() => {
      expect(previous).not.toBeDisabled();
    });
    fireEvent.click(previous);

    await waitFor(() => {
      const staffCalls = mockGet.mock.calls.filter((call) => call[0] === "/staff");
      // Page one is the absence of the parameter, not page=1.
      expect(staffCalls.at(-1)?.[1]?.query?.page).toBeUndefined();
    });
  });

  it("hides the create and import actions without the matching permission", async () => {
    mockStaffAndDepartments(offsetPage([], {}, "req-list"));

    renderWithProviders(<StaffTable />);

    await screen.findByText("No staff yet");
    expect(screen.queryByRole("link", { name: "New staff member" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Import" })).not.toBeInTheDocument();
  });
});
