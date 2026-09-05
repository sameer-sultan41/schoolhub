import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RoomForm } from "@/features/timetable/room-form";
import { apiClient } from "@/lib/auth";
import { renderWithProviders } from "@/test-utils";

jest.mock("@/lib/auth", () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("@/features/timetable/use-timetable-reference-data", () => ({
  useCampusOptions: () => ({ data: [{ id: "campus1", name: "Main Campus", code: "MAIN" }] }),
}));

// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockPatch = apiClient.patch as jest.MockedFunction<typeof apiClient.patch>;

const EXISTING = {
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

/** FormLabel's `required` appends an aria-hidden asterisk, so a required field's
 * accessible name is "Name *" — the lookups below have to be regexes. */
async function fillNewRoom(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Add room" }));
  await user.click(screen.getByRole("combobox", { name: "Campus" }));
  await user.click(await screen.findByRole("option", { name: "Main Campus" }));
  await user.type(screen.getByLabelText(/^Name/), "Chemistry Lab");
  await user.type(screen.getByLabelText(/^Code/), "L-13");
}

describe("RoomForm", () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPatch.mockReset();
  });

  it("creates a room, sending null for the details left blank", async () => {
    mockPost.mockResolvedValue({ data: {}, meta: undefined, requestId: null, status: 201 });
    const user = userEvent.setup();
    renderWithProviders(<RoomForm />);

    await fillNewRoom(user);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/rooms", {
        campus_id: "campus1",
        name: "Chemistry Lab",
        code: "L-13",
        room_type: "classroom",
        capacity: null,
        building: null,
        floor: null,
        is_active: true,
      });
    });
  });

  it("sends a capacity as a number once one is given", async () => {
    mockPost.mockResolvedValue({ data: {}, meta: undefined, requestId: null, status: 201 });
    const user = userEvent.setup();
    renderWithProviders(<RoomForm />);

    await fillNewRoom(user);
    await user.type(screen.getByLabelText("Capacity"), "24");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPost.mock.calls[0]?.[1]).toMatchObject({ capacity: 24 });
    });
  });

  it("explains what a blank capacity means, and what a filled one means", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RoomForm />);

    await user.click(screen.getByRole("button", { name: "Add room" }));
    expect(screen.getByText("Leave blank when the room has no fixed seating.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Capacity"), "24");

    expect(
      await screen.findByText("A section larger than this raises a warning, not a block."),
    ).toBeInTheDocument();
  });

  it("patches an existing room", async () => {
    mockPatch.mockResolvedValue({ data: {}, meta: undefined, requestId: null, status: 200 });
    const user = userEvent.setup();
    renderWithProviders(<RoomForm room={EXISTING} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith("/rooms/room1", {
        campus_id: "campus1",
        name: "Physics Lab",
        code: "L-12",
        room_type: "lab",
        capacity: 30,
        building: "Science Block",
        floor: "1",
        is_active: true,
      });
    });
  });

  it("refuses to submit without a campus, a name and a code", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RoomForm />);

    await user.click(screen.getByRole("button", { name: "Add room" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("A room needs a name.")).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("routes a server field error onto the field it names", async () => {
    mockPost.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: "Invalid.",
        status: 400,
        url: "/rooms",
        details: [{ field: "code", issue: "This code is already used on that campus." }],
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<RoomForm />);

    await fillNewRoom(user);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("This code is already used on that campus."),
    ).toBeInTheDocument();
  });
});
