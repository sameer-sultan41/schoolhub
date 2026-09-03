import { headers } from "next/headers";
import type * as ReactModule from "react";
import { makeTenant } from "@/test-utils";
import { readJson } from "./api";
import { TENANT_HOST_HEADER } from "./host";
import { canonicalOrigin, getActiveTenant, getRequestHost, resolveTenant } from "./tenant";

// react's cache() memoizes per-request; outside of an actual render it would otherwise
// share results across these tests in a way that has nothing to do with what each one
// sets up.
jest.mock("react", () => ({
  ...jest.requireActual<typeof ReactModule>("react"),
  cache: (fn: unknown) => fn,
}));

jest.mock("next/headers", () => ({ headers: jest.fn() }));
jest.mock("./api", () => ({
  readJson: jest.fn(),
  tenantTag: (id: string) => `tenant:${id}`,
}));

const mockHeaders = headers as jest.MockedFunction<typeof headers>;
const mockReadJson = readJson as jest.MockedFunction<typeof readJson>;

function mockHost(host: string | null) {
  mockHeaders.mockResolvedValue({
    get: (name: string) => (name === TENANT_HOST_HEADER ? host : null),
  } as Awaited<ReturnType<typeof headers>>);
}

describe("getRequestHost", () => {
  it("reads the proxy-resolved host header", async () => {
    mockHost("cityschool.schoolhub.pk");
    await expect(getRequestHost()).resolves.toBe("cityschool.schoolhub.pk");
  });

  it("is null when the proxy set no host", async () => {
    mockHost(null);
    await expect(getRequestHost()).resolves.toBeNull();
  });
});

describe("resolveTenant", () => {
  beforeEach(() => {
    mockReadJson.mockReset();
  });

  it("is unknown when there is no request host", async () => {
    mockHost(null);
    await expect(resolveTenant()).resolves.toEqual({ status: "unknown" });
    expect(mockReadJson).not.toHaveBeenCalled();
  });

  it("is unknown when the host matches no tenant", async () => {
    mockHost("nobody.schoolhub.pk");
    mockReadJson.mockResolvedValue(null);
    await expect(resolveTenant()).resolves.toEqual({ status: "unknown" });
  });

  it("is active for a live tenant", async () => {
    mockHost("cityschool.schoolhub.pk");
    const tenant = makeTenant();
    mockReadJson.mockResolvedValue(tenant);
    await expect(resolveTenant()).resolves.toEqual({ status: "active", tenant });
  });

  it("is suspended for a suspended tenant", async () => {
    mockHost("cityschool.schoolhub.pk");
    const tenant = makeTenant({ status: "suspended" });
    mockReadJson.mockResolvedValue(tenant);
    await expect(resolveTenant()).resolves.toEqual({ status: "suspended", tenant });
  });

  it("is suspended for a closed tenant", async () => {
    mockHost("cityschool.schoolhub.pk");
    const tenant = makeTenant({ status: "closed" });
    mockReadJson.mockResolvedValue(tenant);
    await expect(resolveTenant()).resolves.toEqual({ status: "suspended", tenant });
  });
});

describe("getActiveTenant", () => {
  beforeEach(() => {
    mockReadJson.mockReset();
  });

  it("returns the tenant when active", async () => {
    mockHost("cityschool.schoolhub.pk");
    const tenant = makeTenant();
    mockReadJson.mockResolvedValue(tenant);
    await expect(getActiveTenant()).resolves.toEqual(tenant);
  });

  it("returns null when not active", async () => {
    mockHost(null);
    await expect(getActiveTenant()).resolves.toBeNull();
  });
});

describe("canonicalOrigin", () => {
  it("prefers the tenant's verified custom domain", () => {
    const tenant = makeTenant({ custom_domain: "www.cityschool.edu.pk" });
    expect(canonicalOrigin(tenant, "cityschool.schoolhub.pk")).toBe(
      "https://www.cityschool.edu.pk",
    );
  });

  it("falls back to the platform subdomain with no custom domain", () => {
    const tenant = makeTenant({ custom_domain: null });
    expect(canonicalOrigin(tenant, "cityschool.schoolhub.pk")).toBe(
      "https://cityschool.schoolhub.pk",
    );
  });
});
