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

beforeEach(() => {
  jest.resetModules();
  for (const mock of [mockGet, mockPost, mockPatch, mockDelete]) mock.mockReset();
  mockGet.mockResolvedValue({ data: [{ id: "d1" }], meta: {} });
  mockPost.mockResolvedValue({ data: { id: "d1" } });
  mockPatch.mockResolvedValue({ data: { id: "d1" } });
  mockDelete.mockResolvedValue({ data: undefined });
});

describe("custom-domains-service", () => {
  it("reads every domain in one page", async () => {
    const { fetchCustomDomains } = await import("../custom-domains-service");

    await expect(fetchCustomDomains()).resolves.toEqual([{ id: "d1" }]);

    expect(mockGet).toHaveBeenCalledWith(
      "/custom-domains",
      expect.objectContaining({ query: expect.objectContaining({ page_size: 100 }) }),
    );
  });

  it("claims, verifies, makes primary and removes a domain", async () => {
    const { createCustomDomain, verifyCustomDomain, setPrimaryCustomDomain, deleteCustomDomain } =
      await import("../custom-domains-service");

    await createCustomDomain({ domain: "www.greenfield.edu.pk" });
    await verifyCustomDomain("d1");
    await setPrimaryCustomDomain("d1", true);
    await deleteCustomDomain("d1");

    expect(mockPost).toHaveBeenNthCalledWith(1, "/custom-domains", {
      domain: "www.greenfield.edu.pk",
    });
    expect(mockPost).toHaveBeenNthCalledWith(2, "/custom-domains/d1:verify");
    expect(mockPatch).toHaveBeenCalledWith("/custom-domains/d1", { is_primary: true });
    expect(mockDelete).toHaveBeenCalledWith("/custom-domains/d1");
  });
});

describe("custom-domains helpers", () => {
  it("says why a domain can't be primary until it is active with HTTPS issued", async () => {
    const { primaryBlocker } = await import("../custom-domains-helper");
    const { isVerifiable } = await import("../custom-domains-constant");

    expect(primaryBlocker({ status: "pending_dns", tls_status: "pending" })).toBe("not_active");
    expect(primaryBlocker({ status: "active", tls_status: "pending" })).toBe("tls_not_issued");
    expect(primaryBlocker({ status: "active", tls_status: "issued" })).toBeNull();
    expect(isVerifiable({ status: "failed" })).toBe(true);
    expect(isVerifiable({ status: "active" })).toBe(false);
  });
});
