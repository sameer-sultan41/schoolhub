import type { WebsitePage } from "@schoolhub/types";
import { render, screen } from "@testing-library/react";
import { notFound } from "next/navigation";
import { getPage, getSiteSettings } from "@/lib/content";
import { getRequestHost, resolveTenant } from "@/lib/tenant";
import { makeTenant } from "@/test-utils";
import { getTheme } from "@/themes";
import { RenderPage, renderPageMetadata } from "./render-page";

// The real notFound() never returns (type "never") — control flow after it assumes that.
// A no-op mock would fall through into code that assumes a tenant is present.
jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
jest.mock("@/lib/content", () => ({
  getPage: jest.fn(),
  getSiteSettings: jest.fn(),
  toPageSlug: jest.requireActual("@/lib/content").toPageSlug,
}));
jest.mock("@/lib/tenant", () => ({
  resolveTenant: jest.fn(),
  getRequestHost: jest.fn(),
  canonicalOrigin: jest.requireActual("@/lib/tenant").canonicalOrigin,
}));
jest.mock("@/themes", () => ({
  getTheme: jest.fn(),
  resolveSection: jest.requireActual("@/themes").resolveSection,
}));

const mockNotFound = notFound as jest.MockedFunction<typeof notFound>;
const mockGetPage = getPage as jest.MockedFunction<typeof getPage>;
const mockGetSiteSettings = getSiteSettings as jest.MockedFunction<typeof getSiteSettings>;
const mockResolveTenant = resolveTenant as jest.MockedFunction<typeof resolveTenant>;
const mockGetRequestHost = getRequestHost as jest.MockedFunction<typeof getRequestHost>;
const mockGetTheme = getTheme as jest.MockedFunction<typeof getTheme>;

function makePage(overrides: Partial<WebsitePage> = {}): WebsitePage {
  return {
    id: "p1",
    slug: "",
    title: "Home",
    seo: {},
    is_published: true,
    published_at: "2027-01-01T00:00:00Z",
    updated_at: "2027-01-01T00:00:00Z",
    sections: [],
    ...overrides,
  };
}

function FakeSection({ section }: { section: { id: string } }) {
  return <div data-testid="section">{section.id}</div>;
}

const FAKE_THEME = {
  name: "default",
  label: "Fake",
  sections: { hero: FakeSection },
  Navigation: () => <nav data-testid="nav" />,
  Footer: () => <footer data-testid="footer" />,
};

beforeEach(() => {
  // .mockClear(), not .mockReset() — a reset would also wipe the throwing implementation
  // set in the jest.mock factory above, leaving notFound() a silent no-op.
  mockNotFound.mockClear();
  mockGetPage.mockReset();
  mockGetSiteSettings.mockReset().mockResolvedValue(null);
  mockResolveTenant.mockReset();
  mockGetRequestHost.mockReset();
  mockGetTheme.mockReturnValue(FAKE_THEME);
});

describe("renderPageMetadata", () => {
  it("is unindexed and generic for an unknown host", async () => {
    mockResolveTenant.mockResolvedValue({ status: "unknown" });
    await expect(renderPageMetadata([])).resolves.toEqual({
      title: "Not available",
      robots: { index: false, follow: false },
    });
  });

  it("is unindexed and generic for a suspended tenant", async () => {
    mockResolveTenant.mockResolvedValue({ status: "suspended", tenant: makeTenant() });
    await expect(renderPageMetadata([])).resolves.toEqual({
      title: "Not available",
      robots: { index: false, follow: false },
    });
  });

  it("falls back to the tenant name, unindexed, when the page does not exist", async () => {
    const tenant = makeTenant({ name: "City School" });
    mockResolveTenant.mockResolvedValue({ status: "active", tenant });
    mockGetPage.mockResolvedValue(null);

    await expect(renderPageMetadata(["missing"])).resolves.toEqual({
      title: "City School",
      robots: { index: false, follow: false },
    });
  });

  it("builds full SEO metadata for a published page", async () => {
    const tenant = makeTenant({ name: "City School" });
    mockResolveTenant.mockResolvedValue({ status: "active", tenant });
    mockGetRequestHost.mockResolvedValue("cityschool.schoolhub.pk");
    mockGetPage.mockResolvedValue(
      makePage({
        slug: "about",
        title: "About us",
        seo: { description: "Learn about our school." },
      }),
    );

    const metadata = await renderPageMetadata(["about"]);

    expect(metadata.title).toBe("About us");
    expect(metadata.description).toBe("Learn about our school.");
    expect(metadata.alternates).toEqual({
      canonical: "https://cityschool.schoolhub.pk/about",
    });
    expect(metadata.robots).toEqual({ index: true, follow: true });
  });

  it("respects an explicit noindex flag and a custom canonical URL", async () => {
    const tenant = makeTenant();
    mockResolveTenant.mockResolvedValue({ status: "active", tenant });
    mockGetRequestHost.mockResolvedValue("cityschool.schoolhub.pk");
    mockGetPage.mockResolvedValue(
      makePage({
        seo: { noindex: true, canonical_url: "https://cityschool.edu.pk/" },
      }),
    );

    const metadata = await renderPageMetadata([]);

    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.alternates).toEqual({ canonical: "https://cityschool.edu.pk/" });
  });
});

describe("RenderPage", () => {
  it("calls notFound for an unknown host", async () => {
    mockResolveTenant.mockResolvedValue({ status: "unknown" });
    await expect(RenderPage({ segments: [] })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it("shows a neutral notice for a suspended tenant", async () => {
    mockResolveTenant.mockResolvedValue({ status: "suspended", tenant: makeTenant() });
    const ui = await RenderPage({ segments: [] });
    render(ui);
    expect(screen.getByText("This website is unavailable")).toBeInTheDocument();
  });

  it("calls notFound when the page does not exist", async () => {
    mockResolveTenant.mockResolvedValue({ status: "active", tenant: makeTenant() });
    mockGetPage.mockResolvedValue(null);
    await expect(RenderPage({ segments: [] })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it("calls notFound when the page exists but is not published", async () => {
    mockResolveTenant.mockResolvedValue({ status: "active", tenant: makeTenant() });
    mockGetPage.mockResolvedValue(makePage({ is_published: false }));
    await expect(RenderPage({ segments: [] })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it("renders sections in position order, skipping unresolvable types", async () => {
    mockResolveTenant.mockResolvedValue({ status: "active", tenant: makeTenant() });
    mockGetPage.mockResolvedValue(
      makePage({
        sections: [
          { id: "second", type: "hero", position: 1, props: {} },
          { id: "first", type: "hero", position: 0, props: {} },
          { id: "unknown", type: "not_implemented", position: 2, props: {} },
        ],
      }),
    );

    const ui = await RenderPage({ segments: [] });
    render(ui);

    const rendered = screen.getAllByTestId("section").map((el) => el.textContent);
    expect(rendered).toEqual(["first", "second"]);
    expect(screen.getByTestId("nav")).toBeInTheDocument();
    expect(screen.getByTestId("footer")).toBeInTheDocument();
  });
});
