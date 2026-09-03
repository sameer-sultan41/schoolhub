import { getPublishedPaths } from "@/lib/content";
import { getRequestHost, resolveTenant } from "@/lib/tenant";
import { makeTenant } from "@/test-utils";
import sitemap from "./sitemap";

jest.mock("@/lib/content", () => ({ getPublishedPaths: jest.fn() }));
jest.mock("@/lib/tenant", () => ({
  resolveTenant: jest.fn(),
  getRequestHost: jest.fn(),
  canonicalOrigin: jest.requireActual("@/lib/tenant").canonicalOrigin,
}));

const mockGetPublishedPaths = getPublishedPaths as jest.MockedFunction<typeof getPublishedPaths>;
const mockResolveTenant = resolveTenant as jest.MockedFunction<typeof resolveTenant>;
const mockGetRequestHost = getRequestHost as jest.MockedFunction<typeof getRequestHost>;

describe("sitemap", () => {
  beforeEach(() => {
    mockGetPublishedPaths.mockReset();
    mockResolveTenant.mockReset();
    mockGetRequestHost.mockReset();
  });

  it("is empty for a non-active tenant", async () => {
    mockResolveTenant.mockResolvedValue({ status: "unknown" });
    await expect(sitemap()).resolves.toEqual([]);
    expect(mockGetPublishedPaths).not.toHaveBeenCalled();
  });

  it("builds absolute URLs on the canonical origin from published paths", async () => {
    const tenant = makeTenant();
    mockResolveTenant.mockResolvedValue({ status: "active", tenant });
    mockGetRequestHost.mockResolvedValue("cityschool.schoolhub.pk");
    mockGetPublishedPaths.mockResolvedValue([
      { path: "/about", updated_at: "2027-01-01T00:00:00Z" },
      { path: "admissions", updated_at: "2027-01-02T00:00:00Z" },
    ]);

    const result = await sitemap();

    expect(result).toEqual([
      {
        url: "https://cityschool.schoolhub.pk/about",
        lastModified: new Date("2027-01-01T00:00:00Z"),
      },
      {
        url: "https://cityschool.schoolhub.pk/admissions",
        lastModified: new Date("2027-01-02T00:00:00Z"),
      },
    ]);
  });
});
