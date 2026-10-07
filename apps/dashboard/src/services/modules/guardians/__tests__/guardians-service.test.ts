import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({
      get: mockGet,
      post: mockPost,
      put: jest.fn(),
      patch: mockPatch,
      delete: jest.fn(),
      refresh: jest.fn(),
    })),
  };
});

describe("guardians-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
  });

  it("searchGuardians sends the search term as a query param", async () => {
    const { searchGuardians } = await import("../guardians-service");
    // `GuardianViewSet` doesn't override `pagination_class`, so it inherits the
    // project default `CursorPagination` (apps/api/core/api/pagination.py) — cursor
    // metadata, not `StudentViewSet`'s page-number shape. `fetchPage` itself never
    // inspects this field's contents, but the mock should still reflect the real
    // endpoint's shape rather than a different viewset's.
    mockGet.mockResolvedValue({
      data: [{ id: "g1", first_name: "Ayesha", last_name: "Raza" }],
      meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 20 } },
    });

    const result = await searchGuardians("Ayesha");

    expect(mockGet).toHaveBeenCalledWith(
      "/guardians",
      expect.objectContaining({ query: { search: "Ayesha", page_size: 20 } }),
    );
    expect(result).toEqual([{ id: "g1", first_name: "Ayesha", last_name: "Raza" }]);
  });

  it("createGuardian maps camelCase input to the snake_case request body", async () => {
    const { createGuardian } = await import("../guardians-service");
    mockPost.mockResolvedValue({ data: { id: "g1" } });

    await createGuardian({
      firstName: "Ayesha",
      lastName: "Raza",
      phone: "0300-0000000",
      altPhone: "0300-1111111",
      email: "ayesha@example.com",
      photoFileId: "file-1",
    });

    expect(mockPost).toHaveBeenCalledWith("/guardians", {
      first_name: "Ayesha",
      last_name: "Raza",
      phone: "0300-0000000",
      alt_phone: "0300-1111111",
      email: "ayesha@example.com",
      photo_file_id: "file-1",
    });
  });

  it("createGuardian omits optional fields that were never filled in", async () => {
    const { createGuardian } = await import("../guardians-service");
    mockPost.mockResolvedValue({ data: { id: "g1" } });

    await createGuardian({ firstName: "Ayesha", lastName: "Raza", phone: "0300-0000000" });

    expect(mockPost).toHaveBeenCalledWith("/guardians", {
      first_name: "Ayesha",
      last_name: "Raza",
      phone: "0300-0000000",
    });
  });

  it("fetchGuardianById gets one guardian by id", async () => {
    const { fetchGuardianById } = await import("../guardians-service");
    mockGet.mockResolvedValue({ data: { id: "g1", first_name: "Ayesha", last_name: "Raza" } });

    const result = await fetchGuardianById("g1");

    expect(mockGet).toHaveBeenCalledWith("/guardians/g1");
    expect(result).toEqual({ id: "g1", first_name: "Ayesha", last_name: "Raza" });
  });

  it("updateGuardian PATCHes only the fields given", async () => {
    const { updateGuardian } = await import("../guardians-service");
    mockPatch.mockResolvedValue({ data: { id: "g1" } });

    await updateGuardian("g1", { phone: "0300-2222222" });

    expect(mockPatch).toHaveBeenCalledWith("/guardians/g1", { phone: "0300-2222222" });
  });

  it("linkGuardianToStudent posts relationship and flags to the nested endpoint", async () => {
    const { linkGuardianToStudent } = await import("../guardians-service");
    mockPost.mockResolvedValue({ data: { id: "link-1" } });

    await linkGuardianToStudent("student-1", {
      guardianId: "g1",
      relationship: "father",
      isPrimary: true,
      isFeeResponsible: false,
      canPickUp: true,
      receivesCommunications: true,
      hasPortalAccess: true,
    });

    expect(mockPost).toHaveBeenCalledWith("/students/student-1/guardians", {
      guardian_id: "g1",
      relationship: "father",
      is_primary: true,
      is_fee_responsible: false,
      can_pick_up: true,
      receives_communications: true,
      has_portal_access: true,
    });
  });

  it("updateGuardianLink PATCHes link flags by link id", async () => {
    const { updateGuardianLink } = await import("../guardians-service");
    mockPatch.mockResolvedValue({ data: { id: "link-1" } });

    await updateGuardianLink("link-1", { isPrimary: true });

    expect(mockPatch).toHaveBeenCalledWith("/student-guardians/link-1", { is_primary: true });
  });

  it("fetchGuardianLinks lists a student's guardian links", async () => {
    const { fetchGuardianLinks } = await import("../guardians-service");
    mockGet.mockResolvedValue({
      data: [{ id: "link-1", guardian_id: "g1" }],
      meta: { pagination: { next_cursor: null, previous_cursor: null, page_size: 50 } },
    });

    const result = await fetchGuardianLinks("student-1");

    expect(mockGet).toHaveBeenCalledWith(
      "/students/student-1/guardians",
      // 50 (GUARDIAN_LINKS_PAGE_SIZE), not GUARDIAN_SEARCH_PAGE_SIZE's 20 — this lists one
      // student's own links (a small, bounded set), a different call site than the
      // tenant-wide search dropdown.
      expect.objectContaining({ query: { page_size: 50 } }),
    );
    expect(result).toEqual([{ id: "link-1", guardian_id: "g1" }]);
  });
});
