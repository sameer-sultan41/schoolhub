import type * as ApiClientModule from "@schoolhub/api-client";
import type { ApiClientConfig } from "@schoolhub/api-client";

// Same mocking convention as auth-service.test.ts: @/lib/auth's `apiClient` is built once,
// at module scope, via `createApiClient(...)` — intercepting that factory is what lets a
// test control every request this service makes without touching a real transport.
const mockGet = jest.fn();

jest.mock("@schoolhub/api-client", () => {
  const actual = jest.requireActual<typeof ApiClientModule>("@schoolhub/api-client");
  return {
    ...actual,
    createApiClient: jest.fn((_config: ApiClientConfig) => ({ get: mockGet })),
    refreshAccessToken: jest.fn(),
  };
});

describe("TenantService", () => {
  beforeEach(() => {
    jest.resetModules();
    mockGet.mockReset();
  });

  it("fetchCurrentTenant reads the authenticated user's own tenant", async () => {
    const { fetchCurrentTenant } = await import("../tenant-service");
    const { endpoints } = await import("@/services/endpoints");
    mockGet.mockResolvedValueOnce({
      data: { id: "t1", name: "City Grammar School", branding: {} },
    });

    const tenant = await fetchCurrentTenant();

    expect(mockGet).toHaveBeenCalledWith(endpoints.tenant.current);
    expect(tenant).toEqual({ id: "t1", name: "City Grammar School", branding: {} });
  });
});
