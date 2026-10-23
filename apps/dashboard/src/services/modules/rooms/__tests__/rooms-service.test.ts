import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
const mockDelete = jest.fn();

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({
      get: mockGet,
      post: mockPost,
      put: jest.fn(),
      patch: mockPatch,
      delete: mockDelete,
      refresh: jest.fn(),
    })),
  };
});

const PAGE_META = { pagination: { page: 1, page_size: 10, total_count: 0, total_pages: 0 } };

const INPUT = {
  campusId: "campus-1",
  name: "Lab 1",
  code: "LAB-1",
  roomType: "lab" as const,
  capacity: null,
  building: null,
  floor: "2",
  isActive: true,
};

const BODY = {
  campus_id: "campus-1",
  name: "Lab 1",
  code: "LAB-1",
  room_type: "lab",
  capacity: null,
  building: null,
  floor: "2",
  is_active: true,
};

describe("rooms-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
  });

  it("lists /rooms with its campus, type and status filters, keeping is_active=false", async () => {
    const { fetchRoomPage } = await import("../rooms-service");
    mockGet.mockResolvedValue({ data: [], meta: PAGE_META });

    await fetchRoomPage({
      page: 1,
      pageSize: 10,
      search: "lab",
      ordering: "code",
      campusId: "campus-1",
      roomType: "lab",
      isActive: false,
    });

    expect(mockGet).toHaveBeenCalledWith(
      "/rooms",
      expect.objectContaining({
        query: {
          page: 1,
          page_size: 10,
          search: "lab",
          ordering: "code",
          campus_id: "campus-1",
          room_type: "lab",
          is_active: false,
        },
      }),
    );
  });

  it("creates, updates and deletes through the snake_case body", async () => {
    const { createRoom, deleteRoom, updateRoom } = await import("../rooms-service");
    mockPost.mockResolvedValue({ data: { id: "p1" } });
    mockPatch.mockResolvedValue({ data: { id: "p1" } });

    await createRoom(INPUT);
    await updateRoom("p1", INPUT);
    await deleteRoom("p1");

    expect(mockPost).toHaveBeenCalledWith("/rooms", BODY);
    expect(mockPatch).toHaveBeenCalledWith("/rooms/p1", BODY);
    expect(mockDelete).toHaveBeenCalledWith("/rooms/p1");
  });
});
