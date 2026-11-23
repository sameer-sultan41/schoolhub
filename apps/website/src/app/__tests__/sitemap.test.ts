import { getPublishedPaths } from "@/lib/content";
import { resolveTenant } from "@/lib/tenant";
import { makeTenant } from "@/test-utils";
import sitemap from "../sitemap";

jest.mock("@/lib/content", () => ({ getPublishedPaths: jest.fn() }));
jest.mock("@/lib/tenant", () => ({
  resolveTenant: jest.fn(),
  canonicalOrigin: jest.requireActual("@/lib/tenant").canonicalOrigin,
}));

const mockGetPublishedPaths = getPublishedPaths as jest.MockedFunction<typeof getPublishedPaths>;
const mockResolveTenant = resolveTenant as jest.MockedFunction<typeof resolveTenant>;

const HOST = "cityschool.schoolhub.pk";

describe("sitemap", () => {
  beforeEach(() => {
    mockGetPublishedPaths.mockReset();
    mockResolveTenant.mockReset();
  });

  it("is empty for a non-active tenant", async () => {
    mockResolveTenant.mockResolvedValue({ status: "unknown" });
    await expect(sitemap()).resolves.toEqual([]);
    expect(mockGetPublishedPaths).not.toHaveBeenCalled();
  });

  it("builds absolute URLs on the canonical origin from the host's sitemap", async () => {
    mockResolveTenant.mockResolvedValue({ status: "active", tenant: makeTenant(), host: HOST });
    mockGetPublishedPaths.mockResolvedValue([
      { path: "/", updated_at: "2027-01-01T00:00:00Z" },
      { path: "/about", updated_at: "2027-01-01T00:00:00Z" },
      { path: "admissions", updated_at: "2027-01-02T00:00:00Z" },
    ]);

    const result = await sitemap();

    expect(mockGetPublishedPaths).toHaveBeenCalledWith("t1", HOST);
    expect(result).toEqual([
      { url: `https://${HOST}/`, lastModified: new Date("2027-01-01T00:00:00Z") },
      { url: `https://${HOST}/about`, lastModified: new Date("2027-01-01T00:00:00Z") },
      { url: `https://${HOST}/admissions`, lastModified: new Date("2027-01-02T00:00:00Z") },
    ]);
  });
});
