import { ApiError } from "@schoolhub/api-client";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RoomsScreen } from "@/features/timetable/rooms-screen";
import { usePermission } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";
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
  usePathname: () => "/timetable/rooms",
  useRouter: () => mockRouter,
  useSearchParams: () => mockSearchParams,
}));

jest.mock("@/features/timetable/use-timetable-reference-data", () => ({
  useCampusOptions: () => ({ data: [{ id: "campus1", name: "Main Campus", code: "MAIN" }] }),
}));
jest.mock("@/features/timetable/room-form", () => ({
  RoomForm: ({ room }: { room?: { id: string } }) => (
    <div data-testid={room ? `room-form-${room.id}` : "room-form-create"} />
  ),
}));

// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockDelete = apiClient.delete as jest.MockedFunction<typeof apiClient.delete>;
const mockUsePermission = usePermission as jest.MockedFunction<typeof usePermission>;

const LAB = {
  id: "room1",
  campus_id: "campus1",
  name: "Physics Lab",
  code: "L-12",
  room_type: "lab" as const,
  capacity: 30,
  building: "Science Block",
  floor: "1",
  is_active: true,
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
};

const RETIRED_HALL = {
  ...LAB,
  id: "room2",
  name: "Old Hall",
  code: "H-1",
  room_type: "auditorium" as const,
  capacity: null,
  building: null,
  floor: null,
  is_active: false,
};

describe("RoomsScreen", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockDelete.mockReset();
    mockUsePermission.mockReturnValue(false);
    mockSearchParams = new URLSearchParams();
  });

  it("renders a room with its type, capacity and location", async () => {
    mockGet.mockResolvedValue(offsetPage([LAB]));
    renderWithProviders(<RoomsScreen />);

    // Scoped to the row: type and status are chips rather than bare cells now, and a
    // screen-wide query would not say which row it had found them in.
    const row = await screen.findByRole("row", { name: /Physics Lab/ });
    expect(within(row).getByText("L-12")).toBeInTheDocument();
    expect(within(row).getByText("Physics Lab")).toBeInTheDocument();
    expect(within(row).getByText("Lab")).toBeInTheDocument();
    expect(within(row).getByText("Main Campus")).toBeInTheDocument();
    expect(within(row).getByText("30")).toBeInTheDocument();
    expect(within(row).getByText("Science Block · 1")).toBeInTheDocument();
    expect(within(row).getByText("In service")).toBeInTheDocument();
  });

  it("renders a retired room with no capacity as out of service", async () => {
    mockGet.mockResolvedValue(offsetPage([RETIRED_HALL]));
    renderWithProviders(<RoomsScreen />);

    expect(await screen.findByText("Old Hall")).toBeInTheDocument();
    expect(screen.getByText("Out of service")).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /Old Hall/ });
    // Exactly two dashes: the missing capacity and the missing building/floor. The
    // campus is still known, so it must not be a third.
    expect(within(row).getAllByText("—")).toHaveLength(2);
    expect(within(row).getByText("Main Campus")).toBeInTheDocument();
  });

  it("shows the translated empty state", async () => {
    mockGet.mockResolvedValue(offsetPage([]));
    renderWithProviders(<RoomsScreen />);

    expect(await screen.findByText("No rooms yet")).toBeInTheDocument();
    // The row range is suppressed on an empty result: "0–0 of 0" beneath an empty state
    // that has already said there is nothing here is noise.
    expect(screen.queryByText("0–0 of 0")).not.toBeInTheDocument();
  });

  it("filters by room type", async () => {
    mockGet.mockResolvedValue(offsetPage([LAB]));
    const user = userEvent.setup();
    renderWithProviders(<RoomsScreen />);
    await screen.findByText("Physics Lab");

    // The filter row sits inside the table's card now, but the select is still named by
    // its label, so the reader reaches it exactly as before.
    await user.click(screen.getByRole("combobox", { name: "Room type" }));
    await user.click(await screen.findByRole("option", { name: "Lab" }));

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query).toMatchObject({ room_type: "lab" });
    });
  });

  it("clicking a page number asks the server for that page", async () => {
    // Two pages' worth: the pager only renders numbers when there is somewhere to go.
    mockGet.mockResolvedValue(offsetPage([LAB], { total_count: 30, page_size: 25 }));
    renderWithProviders(<RoomsScreen />);
    await screen.findByText("Physics Lab");

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
    mockGet.mockResolvedValue(offsetPage([LAB]));
    renderWithProviders(<RoomsScreen />);

    await screen.findByText("Physics Lab");
    expect(screen.queryByTestId("room-form-create")).not.toBeInTheDocument();
    expect(screen.queryByTestId("room-form-room1")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("removes a room", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(offsetPage([LAB]));
    mockDelete.mockResolvedValue({ data: null, meta: undefined, requestId: null, status: 204 });
    const user = userEvent.setup();
    renderWithProviders(<RoomsScreen />);

    await user.click(await screen.findByRole("button", { name: "Remove" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith("/rooms/room1");
    });
  });

  it("renders the error envelope in the table's error slot on failure", async () => {
    mockGet.mockRejectedValue(
      new ApiError({
        code: "server_error",
        message: "boom",
        status: 500,
        url: "/rooms",
        requestId: "req-2",
      }),
    );
    renderWithProviders(<RoomsScreen />);

    expect(await screen.findByText(/went wrong on our side/i)).toBeInTheDocument();
    // The table stays put — the envelope now goes into its own error slot — but the
    // empty state must NOT appear: a failed request is not an empty result set, and
    // saying so would tell the reader something untrue about their own school.
    expect(screen.queryByText("No rooms yet")).not.toBeInTheDocument();
  });
});
