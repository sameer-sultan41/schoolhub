import { resolveTenant } from "@/lib/tenant";
import { makeTenant } from "@/test-utils";
import robots from "../robots";

jest.mock("@/lib/tenant", () => ({
  resolveTenant: jest.fn(),
  canonicalOrigin: jest.requireActual("@/lib/tenant").canonicalOrigin,
}));

const mockResolveTenant = resolveTenant as jest.MockedFunction<typeof resolveTenant>;

const HOST = "cityschool.schoolhub.pk";

describe("robots", () => {
  beforeEach(() => {
    mockResolveTenant.mockReset();
  });

  it("disallows everything for an unknown host", async () => {
    mockResolveTenant.mockResolvedValue({ status: "unknown" });
    await expect(robots()).resolves.toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
  });

  it("disallows everything for an unavailable site", async () => {
    mockResolveTenant.mockResolvedValue({
      status: "unavailable",
      tenant: makeTenant({ website_status: "maintenance" }),
      host: HOST,
    });
    await expect(robots()).resolves.toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
  });

  it("allows everything and points at the sitemap for an active tenant", async () => {
    mockResolveTenant.mockResolvedValue({ status: "active", tenant: makeTenant(), host: HOST });

    await expect(robots()).resolves.toEqual({
      rules: [{ userAgent: "*", allow: "/" }],
      sitemap: `https://${HOST}/sitemap.xml`,
      host: `https://${HOST}`,
    });
  });

  it("prefers the tenant's custom domain as the canonical host", async () => {
    const tenant = makeTenant({ custom_domain: "www.cityschool.edu.pk" });
    mockResolveTenant.mockResolvedValue({ status: "active", tenant, host: HOST });

    const result = await robots();
    expect(result.host).toBe("https://www.cityschool.edu.pk");
  });
});
