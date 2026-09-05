import { ApiError, type ApiResult } from "@schoolhub/api-client";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PeriodsScreen } from "@/features/timetable/periods-screen";
import { usePermission } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";
import { renderWithProviders } from "@/test-utils";

jest.mock("@/lib/auth", () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("@/hooks/use-session", () => ({
  usePermission: jest.fn(() => false),
  useAnyPermission: jest.fn(() => false),
}));
jest.mock("next/navigation", () => ({ usePathname: () => "/timetable/periods" }));
jest.mock("@/features/timetable/use-timetable-reference-data", () => ({
  useCampusOptions: () => ({ data: [{ id: "campus1", name: "Main Campus", code: "MAIN" }] }),
}));
// The form has its own spec; stubbing it keeps this one about the list.
jest.mock("@/features/timetable/period-form", () => ({
  PeriodForm: ({ period }: { period?: { id: string } }) => (
    <div data-testid={period ? `period-form-${period.id}` : "period-form-create"} />
  ),
}));

// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockDelete = apiClient.delete as jest.MockedFunction<typeof apiClient.delete>;
const mockUsePermission = usePermission as jest.MockedFunction<typeof usePermission>;

const TEACHING_PERIOD = {
  id: "p1",
  campus_id: "campus1",
  name: "Period 1",
  sequence: 1,
  start_time: "08:00:00",
  end_time: "08:40:00",
  is_break: false,
  weekdays: null,
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
};

const TENANT_WIDE_BREAK = {
  ...TEACHING_PERIOD,
  id: "p2",
  campus_id: null,
  name: "Recess",
  sequence: 2,
  start_time: "08:40:00",
  end_time: "09:00:00",
  is_break: true,
  weekdays: [0, 4],
};

function page(items: unknown[], nextCursor: string | null = null): ApiResult<unknown> {
  return {
    data: items,
    meta: { pagination: { next_cursor: nextCursor, previous_cursor: null, page_size: 25 } },
    requestId: "req-list",
    status: 200,
  };
}

describe("PeriodsScreen", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockDelete.mockReset();
    mockUsePermission.mockReturnValue(false);
  });

  it("renders a teaching period with its campus and times", async () => {
    mockGet.mockResolvedValue(page([TEACHING_PERIOD]));
    renderWithProviders(<PeriodsScreen />);

    expect(await screen.findByText("Period 1")).toBeInTheDocument();
    expect(screen.getByText("08:00:00 – 08:40:00")).toBeInTheDocument();
    expect(screen.getByText("Main Campus")).toBeInTheDocument();
    expect(screen.getByText("Teaching")).toBeInTheDocument();
    expect(screen.getByText("Every working day")).toBeInTheDocument();
  });

  it("reads a null campus as every campus, not as a missing value", async () => {
    mockGet.mockResolvedValue(page([TENANT_WIDE_BREAK]));
    renderWithProviders(<PeriodsScreen />);

    expect(await screen.findByText("Recess")).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /Recess/ });
    expect(within(row).getByText("All campuses")).toBeInTheDocument();
    expect(within(row).getByText("Break")).toBeInTheDocument();
    expect(within(row).getByText("Mon, Fri")).toBeInTheDocument();
  });

  it("shows the translated empty state", async () => {
    mockGet.mockResolvedValue(page([]));
    renderWithProviders(<PeriodsScreen />);

    expect(await screen.findByText("No periods found.")).toBeInTheDocument();
  });

  it("filters by campus", async () => {
    mockGet.mockResolvedValue(page([TEACHING_PERIOD]));
    const user = userEvent.setup();
    renderWithProviders(<PeriodsScreen />);
    await screen.findByText("Period 1");

    await user.click(screen.getByRole("combobox", { name: "Campus" }));
    await user.click(await screen.findByRole("option", { name: "Main Campus" }));

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query).toMatchObject({ campus_id: "campus1" });
    });
  });

  it("pages forward by cursor", async () => {
    mockGet.mockResolvedValue(page([TEACHING_PERIOD], "cursor-2"));
    renderWithProviders(<PeriodsScreen />);
    await screen.findByText("Period 1");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query?.cursor).toBe("cursor-2");
    });
  });

  it("hides every mutating control without permission", async () => {
    mockGet.mockResolvedValue(page([TEACHING_PERIOD]));
    renderWithProviders(<PeriodsScreen />);

    await screen.findByText("Period 1");
    expect(screen.queryByTestId("period-form-create")).not.toBeInTheDocument();
    expect(screen.queryByTestId("period-form-p1")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("removes a period and reports the 409 when it is already in use", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(page([TEACHING_PERIOD]));
    mockDelete.mockRejectedValue(
      new ApiError({
        code: "conflict",
        message: "in use",
        status: 409,
        url: "/periods/p1",
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<PeriodsScreen />);

    await user.click(await screen.findByRole("button", { name: "Remove" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith("/periods/p1");
    });
    expect(await screen.findByText(/conflicts with the current data/i)).toBeInTheDocument();
  });

  it("renders the error envelope instead of the table on failure", async () => {
    mockGet.mockRejectedValue(
      new ApiError({
        code: "server_error",
        message: "boom",
        status: 500,
        url: "/periods",
        requestId: "req-2",
      }),
    );
    renderWithProviders(<PeriodsScreen />);

    expect(await screen.findByText(/went wrong on our side/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
