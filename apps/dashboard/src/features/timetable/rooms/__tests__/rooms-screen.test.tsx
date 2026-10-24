import { ApiError } from "@schoolhub/api-client";
import type { AuthenticatedUser, PermissionKey } from "@schoolhub/types";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { roomPage, roomRecord } from "@/services/modules/rooms/__tests__/rooms-fixtures";
import { CAMPUS_ID } from "@/test-fixtures/academics";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { RoomsTable } from "../rooms-table";
import { RoomsToolbar } from "../rooms-toolbar";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    auth: { fetchCurrentUser: jest.fn() },
    rooms: {
      fetchRoomPage: jest.fn(),
      createRoom: jest.fn(),
      updateRoom: jest.fn(),
      deleteRoom: jest.fn(),
    },
    dashboard: { fetchCampuses: jest.fn() },
  },
}));

const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;
const mockFetchRoomPage = Services.rooms.fetchRoomPage as jest.MockedFunction<
  typeof Services.rooms.fetchRoomPage
>;
const mockCreateRoom = Services.rooms.createRoom as jest.MockedFunction<
  typeof Services.rooms.createRoom
>;
const mockUpdateRoom = Services.rooms.updateRoom as jest.MockedFunction<
  typeof Services.rooms.updateRoom
>;
const mockDeleteRoom = Services.rooms.deleteRoom as jest.MockedFunction<
  typeof Services.rooms.deleteRoom
>;
const mockFetchCampuses = Services.dashboard.fetchCampuses as jest.MockedFunction<
  typeof Services.dashboard.fetchCampuses
>;

/** What `rooms/services.assert_room_not_in_use` answers, word for word. */
const IN_USE =
  "This room is still on a timetable. Take it out of service instead, or remove it from " +
  "every grid cell and upcoming cover first.";

function userWith(...permissions: PermissionKey[]): AuthenticatedUser {
  return buildUser(["timetable.timetable.view", "timetable.room.update", ...permissions]);
}

function renderScreen() {
  renderWithProviders(
    <>
      <RoomsToolbar />
      <RoomsTable />
    </>,
  );
  return userEvent.setup();
}

describe("rooms screen", () => {
  beforeEach(() => {
    setUrl("/timetable/rooms");
    mockFetchCurrentUser
      .mockReset()
      .mockResolvedValue(userWith("timetable.room.create", "timetable.room.delete"));
    mockFetchRoomPage.mockReset().mockResolvedValue(roomPage([roomRecord()]));
    mockCreateRoom.mockReset();
    mockUpdateRoom.mockReset();
    mockDeleteRoom.mockReset();
    mockFetchCampuses.mockReset().mockResolvedValue([{ id: CAMPUS_ID, name: "Main Campus" }]);
  });

  it("lists each room with its type, capacity, place and status", async () => {
    mockFetchRoomPage.mockResolvedValue(
      roomPage([
        roomRecord(),
        roomRecord({
          id: "2f3a4b5c-6d7e-4f8a-9b0c-1d2e3f4a5b6c",
          name: "Physics lab",
          code: "LAB-1",
          room_type: "lab",
          capacity: null,
          building: null,
          floor: null,
          is_active: false,
        }),
      ]),
    );

    renderScreen();

    expect(await screen.findByText("Physics lab")).toBeInTheDocument();
    expect(screen.getByText("Classroom")).toBeInTheDocument();
    expect(screen.getByText("Lab")).toBeInTheDocument();
    expect(screen.getByText("Main block · 1")).toBeInTheDocument();
    expect(screen.getByText("Out of service")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("sends the type and status filters from the URL", async () => {
    setUrl("/timetable/rooms?type=lab&status=inactive");

    renderScreen();

    await waitFor(() => {
      expect(mockFetchRoomPage).toHaveBeenCalledWith(
        expect.objectContaining({ roomType: "lab", isActive: false, ordering: "code" }),
      );
    });
  });

  it("adds a room on a campus, sending a blank building as null", async () => {
    mockCreateRoom.mockResolvedValue(roomRecord());
    const user = renderScreen();

    await user.click(await screen.findByRole("button", { name: "Add room" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("combobox", { name: "Campus" }));
    await user.click(await screen.findByRole("option", { name: "Main Campus" }));
    await user.type(within(dialog).getByLabelText("Code"), "LAB-2");
    await user.type(within(dialog).getByLabelText("Name"), "Chemistry lab");
    await user.click(within(dialog).getByRole("combobox", { name: "Room type" }));
    await user.click(await screen.findByRole("option", { name: "Lab" }));
    await user.type(within(dialog).getByLabelText("Capacity"), "30");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockCreateRoom).toHaveBeenCalledWith({
        campusId: CAMPUS_ID,
        name: "Chemistry lab",
        code: "LAB-2",
        roomType: "lab",
        capacity: 30,
        building: null,
        floor: null,
        isActive: true,
      });
    });
  });

  it("asks for a campus before sending a new room", async () => {
    const user = renderScreen();

    await user.click(await screen.findByRole("button", { name: "Add room" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Code"), "LAB-2");
    await user.type(within(dialog).getByLabelText("Name"), "Chemistry lab");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText("This field is required.")).toBeInTheDocument();
    expect(mockCreateRoom).not.toHaveBeenCalled();
  });

  it("writes a status pick to the URL", async () => {
    const user = renderScreen();

    await user.click(await screen.findByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByRole("option", { name: "In service" }));

    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get("status")).toBe("active");
    });
  });

  it("offers Edit but not Remove to a viewer without the delete key", async () => {
    mockFetchCurrentUser.mockResolvedValue(userWith());

    renderScreen();

    expect(await screen.findByRole("button", { name: "Edit Room 101" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Room 101" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add room" })).not.toBeInTheDocument();
  });

  it("takes a room out of service, sending a cleared capacity as null", async () => {
    mockUpdateRoom.mockResolvedValue(roomRecord());
    const user = renderScreen();

    await user.click(await screen.findByRole("button", { name: "Edit Room 101" }));
    const dialog = await screen.findByRole("dialog");
    await user.clear(within(dialog).getByLabelText("Capacity"));
    await user.click(within(dialog).getByRole("switch", { name: "In service" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockUpdateRoom).toHaveBeenCalledWith(
        roomRecord().id,
        expect.objectContaining({ capacity: null, isActive: false, code: "R-101" }),
      );
    });
  });

  it("keeps the remove dialog open with the server's reason when a room is in use", async () => {
    mockDeleteRoom.mockRejectedValue(
      new ApiError({
        code: "domain_rule_violation",
        message: IN_USE,
        status: 422,
        url: "/rooms",
        details: [{ field: "non_field", issue: IN_USE }],
      }),
    );
    const user = renderScreen();

    await user.click(await screen.findByRole("button", { name: "Remove Room 101" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    expect(await within(dialog).findByText(IN_USE)).toBeInTheDocument();
  });
});
