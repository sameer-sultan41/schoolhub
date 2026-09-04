import { ApiError, type ApiResult } from "@schoolhub/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { StaffTable } from "@/features/staff/staff-table";
import { usePermission } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";

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

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

const STAFF_MEMBER = {
  id: "st1",
  employee_number: "EMP-0001",
  first_name: "Bilal",
  last_name: "Ahmed",
  staff_type: "teaching",
  employment_status: "active",
};

function mockStaffAndDepartments(staffPage: ApiResult<unknown>) {
  mockGet.mockImplementation((path: string) => {
    if (path === "/staff") return Promise.resolve(staffPage);
    if (path === "/departments") {
      return Promise.resolve({
        data: [],
        meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 25 } },
        requestId: "req-departments",
        status: 200,
      });
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
    mockStaffAndDepartments({
      data: [STAFF_MEMBER],
      meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 25 } },
      requestId: "req-list",
      status: 200,
    });

    renderWithProviders(<StaffTable />);

    expect(await screen.findByText("EMP-0001")).toBeInTheDocument();
    expect(screen.getByText("Bilal Ahmed")).toBeInTheDocument();
  });

  it("shows the translated empty state when the result set is empty", async () => {
    mockStaffAndDepartments({
      data: [],
      meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 25 } },
      requestId: "req-list",
      status: 200,
    });

    renderWithProviders(<StaffTable />);

    expect(await screen.findByText("No staff found.")).toBeInTheDocument();
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
    mockStaffAndDepartments({
      data: [STAFF_MEMBER],
      meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 25 } },
      requestId: "req-list",
      status: 200,
    });

    renderWithProviders(<StaffTable />);

    const cell = await screen.findByText("Bilal Ahmed");
    fireEvent.click(cell.closest("tr") as HTMLElement);

    expect(mockPush).toHaveBeenCalledWith("/staff/st1");
  });

  it("clicking Next fetches the next page by cursor when one is available", async () => {
    mockStaffAndDepartments({
      data: [STAFF_MEMBER],
      meta: { pagination: { next_cursor: "page-2", previous_cursor: null, page_size: 25 } },
      requestId: "req-list",
      status: 200,
    });

    renderWithProviders(<StaffTable />);

    await screen.findByText("EMP-0001");
    const nextButton = screen.getByRole("button", { name: "Next" });
    expect(nextButton).not.toBeDisabled();
    fireEvent.click(nextButton);

    await waitFor(() => {
      const staffCalls = mockGet.mock.calls.filter((call) => call[0] === "/staff");
      const lastCall = staffCalls.at(-1)?.[1];
      expect(lastCall?.query?.cursor).toBe("page-2");
    });
  });

  it("debounces the search input before it reaches the query", async () => {
    jest.useFakeTimers();
    mockStaffAndDepartments({
      data: [STAFF_MEMBER],
      meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 25 } },
      requestId: "req-list",
      status: 200,
    });

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
    mockStaffAndDepartments({
      data: [STAFF_MEMBER],
      meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 25 } },
      requestId: "req-list",
      status: 200,
    });

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
    mockStaffAndDepartments({
      data: [STAFF_MEMBER],
      meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 25 } },
      requestId: "req-list",
      status: 200,
    });

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
        return Promise.resolve({
          data: [STAFF_MEMBER],
          meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 25 } },
          requestId: "req-list",
          status: 200,
        });
      }
      if (path === "/departments") {
        return Promise.resolve({
          data: [{ id: "dpt1", name: "Mathematics" }],
          meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 25 } },
          requestId: "req-departments",
          status: 200,
        });
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
    mockStaffAndDepartments({
      data: [STAFF_MEMBER],
      meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 25 } },
      requestId: "req-list",
      status: 200,
    });

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
    mockStaffAndDepartments({
      data: [STAFF_MEMBER],
      meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 25 } },
      requestId: "req-list",
      status: 200,
    });

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

  it("clicking Previous returns to the prior page", async () => {
    mockStaffAndDepartments({
      data: [STAFF_MEMBER],
      meta: { pagination: { next_cursor: "page-2", previous_cursor: null, page_size: 25 } },
      requestId: "req-list",
      status: 200,
    });

    renderWithProviders(<StaffTable />);
    await screen.findByText("EMP-0001");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    const previousButton = await screen.findByRole("button", { name: "Previous" });
    await waitFor(() => {
      expect(previousButton).not.toBeDisabled();
    });

    const staffCallsBeforePrevious = mockGet.mock.calls.filter(
      (call) => call[0] === "/staff",
    ).length;
    fireEvent.click(previousButton);

    await waitFor(() => {
      const staffCalls = mockGet.mock.calls.filter((call) => call[0] === "/staff");
      expect(staffCalls.length).toBeGreaterThan(staffCallsBeforePrevious);
      const lastCall = staffCalls.at(-1)?.[1];
      expect(lastCall?.query?.cursor).toBeUndefined();
    });
  });

  it("hides the create and import actions without the matching permission", async () => {
    mockStaffAndDepartments({
      data: [],
      meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 25 } },
      requestId: "req-list",
      status: 200,
    });

    renderWithProviders(<StaffTable />);

    await screen.findByText("No staff found.");
    expect(screen.queryByRole("link", { name: "New staff member" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Import" })).not.toBeInTheDocument();
  });
});
