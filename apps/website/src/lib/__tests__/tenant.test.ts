import { headers } from "next/headers";
import type * as ReactModule from "react";
import { makeTenant } from "@/test-utils";
import { readJson } from "../api";
import { TENANT_HOST_HEADER, TENANT_KIND_HEADER, TENANT_PATH_HEADER } from "../host";
import {
  canonicalOrigin,
  classifyTenant,
  customDomainRedirectTarget,
  getRequestHost,
  resolveTenant,
  type TenantResolution,
} from "../tenant";

// react's cache() memoizes per-request; outside of an actual render it would otherwise
// share results across these tests in a way that has nothing to do with what each one
// sets up.
jest.mock("react", () => ({
  ...jest.requireActual<typeof ReactModule>("react"),
  cache: (fn: unknown) => fn,
}));

jest.mock("next/headers", () => ({ headers: jest.fn() }));
jest.mock("../api", () => ({ readJson: jest.fn() }));

const mockHeaders = headers as jest.MockedFunction<typeof headers>;
const mockReadJson = readJson as jest.MockedFunction<typeof readJson>;

const HOST = "cityschool.schoolhub.pk";

function mockRequestHeaders(values: Record<string, string>) {
  mockHeaders.mockResolvedValue({
    get: (name: string) => values[name] ?? null,
  } as Awaited<ReturnType<typeof headers>>);
}

function mockHost(host: string | null) {
  mockRequestHeaders(host ? { [TENANT_HOST_HEADER]: host } : {});
}

beforeEach(() => {
  mockReadJson.mockReset();
});

describe("getRequestHost", () => {
  it("reads the proxy-resolved host header", async () => {
    mockHost(HOST);
    await expect(getRequestHost()).resolves.toBe(HOST);
  });

  it("is null when the proxy set no host", async () => {
    mockHost(null);
    await expect(getRequestHost()).resolves.toBeNull();
  });
});

describe("classifyTenant", () => {
  it.each([
    ["trial", "live", "active"],
    ["active", "live", "active"],
    ["past_due", "live", "active"],
    ["suspended", "live", "unavailable"],
    ["active", "maintenance", "unavailable"],
    ["active", "unpublished", "unavailable"],
    ["deprovisioned", "live", "unknown"],
    ["provisioning", "unpublished", "unknown"],
  ] as const)("status %s with a %s site is %s", (status, websiteStatus, expected) => {
    expect(classifyTenant(makeTenant({ status, website_status: websiteStatus }))).toBe(expected);
  });

  it("renders a site that is not live in draft mode", () => {
    const tenant = makeTenant({ website_status: "unpublished" });
    expect(classifyTenant(tenant, { draft: true })).toBe("active");
    expect(classifyTenant(makeTenant({ website_status: "maintenance" }), { draft: true })).toBe(
      "active",
    );
  });

  it("never renders a suspended school, even in draft mode", () => {
    expect(classifyTenant(makeTenant({ status: "suspended" }), { draft: true })).toBe(
      "unavailable",
    );
  });
});

describe("resolveTenant", () => {
  it("is unknown when there is no request host", async () => {
    mockHost(null);
    await expect(resolveTenant()).resolves.toEqual({ status: "unknown" });
    expect(mockReadJson).not.toHaveBeenCalled();
  });

  it("asks the API by host, tagged for host-scoped revalidation", async () => {
    mockHost(HOST);
    mockReadJson.mockResolvedValue(null);
    await resolveTenant();
    expect(mockReadJson).toHaveBeenCalledWith("/public/tenants/by-host", {
      host: HOST,
      revalidate: 300,
      tags: ["tenant-hosts", `tenant-host:${HOST}`],
    });
  });

  it("is unknown when the host matches no tenant", async () => {
    mockHost("nobody.schoolhub.pk");
    mockReadJson.mockResolvedValue(null);
    await expect(resolveTenant()).resolves.toEqual({ status: "unknown" });
  });

  it("is active for a live school, carrying the host", async () => {
    mockHost(HOST);
    const tenant = makeTenant();
    mockReadJson.mockResolvedValue(tenant);
    await expect(resolveTenant()).resolves.toEqual({ status: "active", tenant, host: HOST });
  });

  it.each([
    ["suspended", "live"],
    ["active", "maintenance"],
    ["active", "unpublished"],
  ] as const)("is unavailable for a %s school with a %s site", async (status, websiteStatus) => {
    mockHost(HOST);
    const tenant = makeTenant({ status, website_status: websiteStatus });
    mockReadJson.mockResolvedValue(tenant);
    await expect(resolveTenant()).resolves.toEqual({ status: "unavailable", tenant, host: HOST });
  });

  it.each(["deprovisioned", "provisioning"] as const)(
    "is unknown for a %s school",
    async (status) => {
      mockHost(HOST);
      mockReadJson.mockResolvedValue(makeTenant({ status }));
      await expect(resolveTenant()).resolves.toEqual({ status: "unknown" });
    },
  );
});

describe("customDomainRedirectTarget", () => {
  function active(customDomain: string | null, host = HOST): TenantResolution {
    return { status: "active", tenant: makeTenant({ custom_domain: customDomain }), host };
  }

  it("redirects a subdomain request to the primary custom domain, keeping path and query", async () => {
    mockRequestHeaders({ [TENANT_KIND_HEADER]: "subdomain", [TENANT_PATH_HEADER]: "/about?x=1" });
    await expect(customDomainRedirectTarget(active("www.cityschool.edu.pk"))).resolves.toBe(
      "https://www.cityschool.edu.pk/about?x=1",
    );
  });

  it("keeps a protocol-relative-looking path on the school's own domain", async () => {
    mockRequestHeaders({
      [TENANT_KIND_HEADER]: "subdomain",
      [TENANT_PATH_HEADER]: "//evil.test/x",
    });
    await expect(customDomainRedirectTarget(active("www.cityschool.edu.pk"))).resolves.toBe(
      "https://www.cityschool.edu.pk//evil.test/x",
    );
  });

  it("falls back to the root when the proxy sent no path", async () => {
    mockRequestHeaders({ [TENANT_KIND_HEADER]: "subdomain" });
    await expect(customDomainRedirectTarget(active("www.cityschool.edu.pk"))).resolves.toBe(
      "https://www.cityschool.edu.pk/",
    );
  });

  it("roots a path that lacks its leading slash", async () => {
    mockRequestHeaders({ [TENANT_KIND_HEADER]: "subdomain", [TENANT_PATH_HEADER]: "about" });
    await expect(customDomainRedirectTarget(active("www.cityschool.edu.pk"))).resolves.toBe(
      "https://www.cityschool.edu.pk/about",
    );
  });

  it("does not redirect a request already on a custom domain", async () => {
    mockRequestHeaders({ [TENANT_KIND_HEADER]: "custom-domain", [TENANT_PATH_HEADER]: "/" });
    await expect(
      customDomainRedirectTarget(active("www.cityschool.edu.pk", "cityschool.edu.pk")),
    ).resolves.toBeNull();
  });

  it("does not redirect to the host the request is already on", async () => {
    mockRequestHeaders({ [TENANT_KIND_HEADER]: "subdomain", [TENANT_PATH_HEADER]: "/" });
    await expect(customDomainRedirectTarget(active(HOST))).resolves.toBeNull();
  });

  it("does not redirect a school without a custom domain", async () => {
    mockRequestHeaders({ [TENANT_KIND_HEADER]: "subdomain", [TENANT_PATH_HEADER]: "/" });
    await expect(customDomainRedirectTarget(active(null))).resolves.toBeNull();
  });

  it("does not redirect an unknown or unavailable site", async () => {
    await expect(customDomainRedirectTarget({ status: "unknown" })).resolves.toBeNull();
    await expect(
      customDomainRedirectTarget({
        status: "unavailable",
        tenant: makeTenant({ custom_domain: "www.cityschool.edu.pk" }),
        host: HOST,
      }),
    ).resolves.toBeNull();
  });
});

describe("canonicalOrigin", () => {
  it("prefers the tenant's verified custom domain", () => {
    const tenant = makeTenant({ custom_domain: "www.cityschool.edu.pk" });
    expect(canonicalOrigin(tenant, HOST)).toBe("https://www.cityschool.edu.pk");
  });

  it("falls back to the platform subdomain with no custom domain", () => {
    expect(canonicalOrigin(makeTenant({ custom_domain: null }), HOST)).toBe(`https://${HOST}`);
  });
});
