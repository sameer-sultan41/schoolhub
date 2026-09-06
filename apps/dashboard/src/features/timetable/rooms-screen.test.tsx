import { ApiError, type ApiResult } from "@schoolhub/api-client";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RoomsScreen } from "@/features/timetable/rooms-screen";
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
jest.mock("next/navigation", () => ({ usePathname: () => "/timetable/rooms" }));
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

function page(items: unknown[], nextCursor: string | null = null): ApiResult<unknown> {
  return {
    data: items,
    meta: { pagination: { next_cursor: nextCursor, previous_cursor: null, page_size: 25 } },
    requestId: "req-list",
    status: 200,
  };
}

describe("RoomsScreen", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockDelete.mockReset();
    mockUsePermission.mockReturnValue(false);
  });

  it("renders a room with its type, capacity and location", async () => {
    mockGet.mockResolvedValue(page([LAB]));
    renderWithProviders(<RoomsScreen />);

    expect(await screen.findByText("Physics Lab")).toBeInTheDocument();
    expect(screen.getByText("L-12")).toBeInTheDocument();
    expect(screen.getByText("Lab")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.getByText("Science Block · 1")).toBeInTheDocument();
    expect(screen.getByText("In service")).toBeInTheDocument();
  });

  it("renders a retired room with no capacity as out of service", async () => {
    mockGet.mockResolvedValue(page([RETIRED_HALL]));
    renderWithProviders(<RoomsScreen />);

    expect(await screen.findByText("Old Hall")).toBeInTheDocument();
    expect(screen.getByText("Out of service")).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /Old Hall/ });
    expect(within(row).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("shows the translated empty state", async () => {
    mockGet.mockResolvedValue(page([]));
    renderWithProviders(<RoomsScreen />);

    expect(await screen.findByText("No rooms yet")).toBeInTheDocument();
  });

  it("filters by room type", async () => {
    mockGet.mockResolvedValue(page([LAB]));
    const user = userEvent.setup();
    renderWithProviders(<RoomsScreen />);
    await screen.findByText("Physics Lab");

    await user.click(screen.getByRole("combobox", { name: "Room type" }));
    await user.click(await screen.findByRole("option", { name: "Lab" }));

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query).toMatchObject({ room_type: "lab" });
    });
  });

  it("pages forward by cursor", async () => {
    mockGet.mockResolvedValue(page([LAB], "cursor-2"));
    renderWithProviders(<RoomsScreen />);
    await screen.findByText("Physics Lab");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query?.cursor).toBe("cursor-2");
    });
  });

  it("hides every mutating control without permission", async () => {
    mockGet.mockResolvedValue(page([LAB]));
    renderWithProviders(<RoomsScreen />);

    await screen.findByText("Physics Lab");
    expect(screen.queryByTestId("room-form-create")).not.toBeInTheDocument();
    expect(screen.queryByTestId("room-form-room1")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("removes a room", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(page([LAB]));
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
