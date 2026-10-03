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
});
