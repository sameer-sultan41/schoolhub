import { getRequestHost, resolveTenant } from "@/lib/tenant";
import { makeTenant } from "@/test-utils";
import robots from "./robots";

jest.mock("@/lib/tenant", () => ({
  resolveTenant: jest.fn(),
  getRequestHost: jest.fn(),
  canonicalOrigin: jest.requireActual("@/lib/tenant").canonicalOrigin,
}));

const mockResolveTenant = resolveTenant as jest.MockedFunction<typeof resolveTenant>;
const mockGetRequestHost = getRequestHost as jest.MockedFunction<typeof getRequestHost>;

describe("robots", () => {
  beforeEach(() => {
    mockResolveTenant.mockReset();
    mockGetRequestHost.mockReset();
  });

  it("disallows everything for an unknown host", async () => {
    mockResolveTenant.mockResolvedValue({ status: "unknown" });
    await expect(robots()).resolves.toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
  });

  it("disallows everything for a suspended tenant", async () => {
    mockResolveTenant.mockResolvedValue({ status: "suspended", tenant: makeTenant() });
    await expect(robots()).resolves.toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
  });

  it("allows everything and points at the sitemap for an active tenant", async () => {
    const tenant = makeTenant();
    mockResolveTenant.mockResolvedValue({ status: "active", tenant });
    mockGetRequestHost.mockResolvedValue("cityschool.schoolhub.pk");

    await expect(robots()).resolves.toEqual({
      rules: [{ userAgent: "*", allow: "/" }],
      sitemap: "https://cityschool.schoolhub.pk/sitemap.xml",
      host: "https://cityschool.schoolhub.pk",
    });
  });

  it("prefers the tenant's custom domain as the canonical host", async () => {
    const tenant = makeTenant({ custom_domain: "www.cityschool.edu.pk" });
    mockResolveTenant.mockResolvedValue({ status: "active", tenant });
    mockGetRequestHost.mockResolvedValue("cityschool.schoolhub.pk");

    const result = await robots();
    expect(result.host).toBe("https://www.cityschool.edu.pk");
  });
});
