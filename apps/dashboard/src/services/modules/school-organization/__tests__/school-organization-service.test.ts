import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

const mockGet = jest.fn();

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({
      get: mockGet,
      post: jest.fn(),
      put: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn(),
      refresh: jest.fn(),
    })),
  };
});

describe("school-organization-service", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
  });

  it("fetches houses from the real endpoint", async () => {
    const { fetchHouses } = await import("../school-organization-service");
    mockGet.mockResolvedValue({ data: [{ id: "h1", name: "Griffin" }], meta: {} });

    const result = await fetchHouses();

    expect(mockGet).toHaveBeenCalledWith(
      "/houses",
      expect.objectContaining({ query: { page_size: expect.any(Number) } }),
    );
    expect(result).toEqual([{ id: "h1", name: "Griffin" }]);
  });

  describe("fetchClasses", () => {
    it("returns id/name pairs, sending no is_active by default", async () => {
      const { fetchClasses } = await import("../school-organization-service");
      mockGet.mockResolvedValue({ data: [{ id: "c1", name: "Grade 1" }], meta: {} });

      const result = await fetchClasses();

      expect(mockGet).toHaveBeenCalledWith(
        "/classes",
        expect.objectContaining({ query: { page_size: expect.any(Number) } }),
      );
      const [, options] = mockGet.mock.calls[0] as [string, { query: Record<string, unknown> }];
      expect(options.query).not.toHaveProperty("is_active");
      expect(result).toEqual([{ id: "c1", name: "Grade 1" }]);
    });

    it("sends is_active when requested", async () => {
      const { fetchClasses } = await import("../school-organization-service");
      mockGet.mockResolvedValue({ data: [], meta: {} });

      await fetchClasses({ isActive: true });

      const [, options] = mockGet.mock.calls[0] as [string, { query: Record<string, unknown> }];
      expect(options.query.is_active).toBe(true);
    });
  });

  describe("fetchSections", () => {
    it("scopes by classId and campusId, sending is_active when requested", async () => {
      const { fetchSections } = await import("../school-organization-service");
      mockGet.mockResolvedValue({ data: [{ id: "sec1", name: "A" }], meta: {} });

      const result = await fetchSections({
        classId: "class-1",
        campusId: "campus-1",
        isActive: true,
      });

      expect(mockGet).toHaveBeenCalledWith(
        "/sections",
        expect.objectContaining({
          query: expect.objectContaining({
            class_id: "class-1",
            campus_id: "campus-1",
            is_active: true,
          }),
        }),
      );
      expect(result).toEqual([{ id: "sec1", name: "A" }]);
    });

    it("omits campus_id and is_active when not requested", async () => {
      const { fetchSections } = await import("../school-organization-service");
      mockGet.mockResolvedValue({ data: [], meta: {} });

      await fetchSections({ classId: "class-1" });

      const [, options] = mockGet.mock.calls[0] as [string, { query: Record<string, unknown> }];
      expect(options.query).not.toHaveProperty("campus_id");
      expect(options.query).not.toHaveProperty("is_active");
      expect(options.query.class_id).toBe("class-1");
    });
  });

  describe("fetchAcademicSessions", () => {
    it("drains the academic-sessions list", async () => {
      const { fetchAcademicSessions } = await import("../school-organization-service");
      const sessions = [{ id: "s1", name: "2026-27", status: "active", is_current: true }];
      mockGet.mockResolvedValue({ data: sessions, meta: {} });

      const result = await fetchAcademicSessions();

      expect(mockGet).toHaveBeenCalledWith("/academic-sessions", { query: { page_size: 25 } });
      expect(result).toEqual(sessions);
    });
  });
});
