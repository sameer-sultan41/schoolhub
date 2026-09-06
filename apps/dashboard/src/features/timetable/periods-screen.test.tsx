import { ApiError } from "@schoolhub/api-client";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PeriodsScreen } from "@/features/timetable/periods-screen";
import { usePermission } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";
import { formatTime } from "@/lib/format";
import { offsetPage, renderWithProviders } from "@/test-utils";

jest.mock("@/lib/auth", () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("@/hooks/use-session", () => ({
  usePermission: jest.fn(() => false),
  useAnyPermission: jest.fn(() => false),
}));

/**
 * The router has to ROUND-TRIP, not swallow the write.
 *
 * Filters, sort and page live in the URL now (`useTableParams` → `useSearchParam`), so
 * `replace` is what applies a page click and `useSearchParams` is where the next render
 * reads it back from. A `replace: jest.fn()` that stores nothing would leave the screen
 * on page one forever, and the pager assertions below would pass against a table that
 * never moved. `usePathname` is still here for `TimetableNav`.
 */
let mockSearchParams = new URLSearchParams();
const mockReplace = jest.fn((url: string) => {
  mockSearchParams = new URLSearchParams(url.split("?")[1] ?? "");
});
const mockRouter = { replace: mockReplace, push: jest.fn(), prefetch: jest.fn() };
jest.mock("next/navigation", () => ({
  usePathname: () => "/timetable/periods",
  useRouter: () => mockRouter,
  useSearchParams: () => mockSearchParams,
}));

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

/**
 * Composed through `formatTime` rather than spelled out, for the same reason
 * `pending-work-panel.test.tsx` composes its date: what this screen owes the reader is
 * that the wire value goes through the formatter at all, and pinning the formatter's
 * exact output here would make this spec fail the day the bell schedule's clock format
 * is corrected. The seconds assertion below is the part that is really being claimed.
 */
function timeRange(period: { start_time: string; end_time: string }): string {
  return `${formatTime(period.start_time, "en")} – ${formatTime(period.end_time, "en")}`;
}

describe("PeriodsScreen", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockDelete.mockReset();
    mockUsePermission.mockReturnValue(false);
    mockSearchParams = new URLSearchParams();
  });

  it("renders a teaching period with its campus and times", async () => {
    mockGet.mockResolvedValue(offsetPage([TEACHING_PERIOD]));
    renderWithProviders(<PeriodsScreen />);

    // Scoped to the row: the daily order is a bare "1", which is also what the pager's
    // first page button reads, and the kind is a chip rather than a bare cell.
    const row = await screen.findByRole("row", { name: /Period 1/ });
    expect(within(row).getByText("1")).toBeInTheDocument();
    expect(within(row).getByText("Period 1")).toBeInTheDocument();
    expect(within(row).getByText(timeRange(TEACHING_PERIOD))).toBeInTheDocument();
    expect(within(row).getByText("Main Campus")).toBeInTheDocument();
    expect(within(row).getByText("Teaching")).toBeInTheDocument();
    expect(within(row).getByText("Every working day")).toBeInTheDocument();
    // DRF serialises a TimeField with seconds a bell schedule never has; the cell drops
    // them rather than putting four characters of noise on both ends of every row.
    expect(screen.queryByText("08:00:00 – 08:40:00")).not.toBeInTheDocument();
  });

  it("reads a null campus as every campus, not as a missing value", async () => {
    mockGet.mockResolvedValue(offsetPage([TENANT_WIDE_BREAK]));
    renderWithProviders(<PeriodsScreen />);

    expect(await screen.findByText("Recess")).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /Recess/ });
    expect(within(row).getByText("All campuses")).toBeInTheDocument();
    expect(within(row).getByText("Break")).toBeInTheDocument();
    // One chip per day, not "Mon, Fri": the days are a set the eye counts, not a
    // sentence it parses.
    expect(within(row).getByText("Mon")).toBeInTheDocument();
    expect(within(row).getByText("Fri")).toBeInTheDocument();
    expect(within(row).queryByText("Tue")).not.toBeInTheDocument();
  });

  it("shows the translated empty state", async () => {
    mockGet.mockResolvedValue(offsetPage([]));
    renderWithProviders(<PeriodsScreen />);

    expect(await screen.findByText("No bell schedule yet")).toBeInTheDocument();
    // The row range is suppressed on an empty result: "0–0 of 0" beneath an empty state
    // that has already said there is nothing here is noise.
    expect(screen.queryByText("0–0 of 0")).not.toBeInTheDocument();
  });

  it("filters by campus", async () => {
    mockGet.mockResolvedValue(offsetPage([TEACHING_PERIOD]));
    const user = userEvent.setup();
    renderWithProviders(<PeriodsScreen />);
    await screen.findByText("Period 1");

    // The filter row sits inside the table's card now, but the select is still named by
    // its label, so the reader reaches it exactly as before.
    await user.click(screen.getByRole("combobox", { name: "Campus" }));
    await user.click(await screen.findByRole("option", { name: "Main Campus" }));

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query).toMatchObject({ campus_id: "campus1" });
    });
  });

  it("clicking a page number asks the server for that page", async () => {
    // Two pages' worth: the pager only renders numbers when there is somewhere to go.
    mockGet.mockResolvedValue(offsetPage([TEACHING_PERIOD], { total_count: 30, page_size: 25 }));
    renderWithProviders(<PeriodsScreen />);
    await screen.findByText("Period 1");

    // With a page number on screen, where the reader is in the list is finally a fact
    // the summary can state — it said nothing at all under cursor paging.
    expect(screen.getByText("1–25 of 30")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Go to page 2" }));

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query?.page).toBe(2);
    });
  });

  it("hides every mutating control without permission", async () => {
    mockGet.mockResolvedValue(offsetPage([TEACHING_PERIOD]));
    renderWithProviders(<PeriodsScreen />);

    await screen.findByText("Period 1");
    expect(screen.queryByTestId("period-form-create")).not.toBeInTheDocument();
    expect(screen.queryByTestId("period-form-p1")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("removes a period and reports the 409 when it is already in use", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(offsetPage([TEACHING_PERIOD]));
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

  it("renders the error envelope in the table's error slot on failure", async () => {
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
    // The table stays put — the envelope now goes into its own error slot — but the
    // empty state must NOT appear: a failed request is not an empty result set, and
    // saying so would tell the reader something untrue about their own school.
    expect(screen.queryByText("No bell schedule yet")).not.toBeInTheDocument();
  });
});
