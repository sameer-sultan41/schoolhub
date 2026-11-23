import { render, screen } from "@testing-library/react";
import { notFound } from "next/navigation";
import { getPage, getSite } from "@/lib/content";
import { resolveTenant } from "@/lib/tenant";
import { makePage, makeSite, makeTenant } from "@/test-utils";
import { getTheme } from "@/themes";
import type { SectionProps, Theme } from "@/themes";
import { RenderPage, renderPageMetadata } from "../render-page";
import { robotsFor } from "../site-shell";

// The real notFound() never returns (type "never") — control flow after it assumes that.
// A no-op mock would fall through into code that assumes a tenant is present.
jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
jest.mock("@/lib/content", () => ({
  getPage: jest.fn(),
  getSite: jest.fn(),
  toPageSlug: jest.requireActual("@/lib/content").toPageSlug,
}));
jest.mock("@/lib/tenant", () => ({
  resolveTenant: jest.fn(),
  canonicalOrigin: jest.requireActual("@/lib/tenant").canonicalOrigin,
}));
jest.mock("@/themes", () => ({
  getTheme: jest.fn(),
  resolveSection: jest.requireActual("@/themes").resolveSection,
}));

const mockNotFound = notFound as jest.MockedFunction<typeof notFound>;
const mockGetPage = getPage as jest.MockedFunction<typeof getPage>;
const mockGetSite = getSite as jest.MockedFunction<typeof getSite>;
const mockResolveTenant = resolveTenant as jest.MockedFunction<typeof resolveTenant>;
const mockGetTheme = getTheme as jest.MockedFunction<typeof getTheme>;

const HOST = "cityschool.schoolhub.pk";

function FakeSection({ section, host, pageId }: SectionProps) {
  return (
    <div data-testid="section">
      {section.id}@{host}#{pageId}
    </div>
  );
}

const FAKE_THEME: Theme = {
  name: "default",
  label: "Fake",
  sections: {
    hero: FakeSection,
    about_school: null,
    principal_message: null,
    departments_grid: null,
    teachers_grid: null,
    classes_list: null,
    admissions_cta: null,
    events_list: null,
    news_list: null,
    notice_board: null,
    gallery: null,
    contact_form: null,
    rich_text: null,
    faq: null,
  },
  Navigation: () => <nav data-testid="nav" />,
  Footer: () => <footer data-testid="footer" />,
};

function active(tenant = makeTenant()) {
  return { status: "active" as const, tenant, host: HOST };
}

beforeEach(() => {
  // .mockClear(), not .mockReset() — a reset would also wipe the throwing implementation
  // set in the jest.mock factory above, leaving notFound() a silent no-op.
  mockNotFound.mockClear();
  mockGetPage.mockReset();
  mockGetSite.mockReset().mockResolvedValue(null);
  mockResolveTenant.mockReset();
  mockGetTheme.mockReset().mockReturnValue(FAKE_THEME);
});

describe("renderPageMetadata", () => {
  it("is unindexed and generic for an unknown host", async () => {
    mockResolveTenant.mockResolvedValue({ status: "unknown" });
    await expect(renderPageMetadata([])).resolves.toEqual({
      title: "Not available",
      robots: { index: false, follow: false },
    });
  });

  it("is unindexed and generic for an unavailable site", async () => {
    mockResolveTenant.mockResolvedValue({
      status: "unavailable",
      tenant: makeTenant(),
      host: HOST,
    });
    await expect(renderPageMetadata([])).resolves.toEqual({
      title: "Not available",
      robots: { index: false, follow: false },
    });
  });

  it("falls back to the tenant name, unindexed, when the page does not exist", async () => {
    mockResolveTenant.mockResolvedValue(active(makeTenant({ name: "City School" })));
    mockGetPage.mockResolvedValue(null);

    await expect(renderPageMetadata(["missing"])).resolves.toEqual({
      title: "City School",
      robots: { index: false, follow: false },
    });
    expect(mockGetPage).toHaveBeenCalledWith("t1", HOST, "missing");
  });

  it("builds full SEO metadata for a published page on its API path", async () => {
    mockResolveTenant.mockResolvedValue(active());
    mockGetPage.mockResolvedValue(
      makePage({
        slug: "about",
        path: "/about",
        title: "About us",
        seo: { ...makePage().seo, description: "Learn about our school." },
      }),
    );

    const metadata = await renderPageMetadata(["about"]);

    expect(metadata.title).toBe("About us");
    expect(metadata.description).toBe("Learn about our school.");
    expect(metadata.alternates).toEqual({ canonical: `https://${HOST}/about` });
    expect(metadata.robots).toEqual({ index: true, follow: true });
  });

  it("uses the SEO title, OG image, noindex flag and custom canonical URL", async () => {
    mockResolveTenant.mockResolvedValue(active());
    mockGetPage.mockResolvedValue(
      makePage({
        seo: {
          ...makePage().seo,
          title: "Welcome",
          og_image_url: "https://api.test.invalid/api/v1/public/files/t1/f1",
          noindex: true,
          canonical_url: "https://cityschool.edu.pk/",
        },
      }),
    );

    const metadata = await renderPageMetadata([]);

    expect(metadata.title).toBe("Welcome");
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.alternates).toEqual({ canonical: "https://cityschool.edu.pk/" });
    expect(metadata.openGraph).toMatchObject({
      images: [{ url: "https://api.test.invalid/api/v1/public/files/t1/f1" }],
    });
  });
});

describe("renderPageMetadata canonical", () => {
  it("makes a /-relative canonical absolute on the school's origin", async () => {
    mockResolveTenant.mockResolvedValue(active());
    mockGetPage.mockResolvedValue(
      makePage({ seo: { ...makePage().seo, canonical_url: "/admissions" } }),
    );

    const metadata = await renderPageMetadata([]);

    expect(metadata.alternates).toEqual({ canonical: `https://${HOST}/admissions` });
  });
});

describe("robotsFor", () => {
  const seo = makePage().seo;

  it.each([
    [null, false, { index: true, follow: true }],
    ["", false, { index: true, follow: true }],
    ["noindex", false, { index: false, follow: true }],
    ["index, nofollow", false, { index: true, follow: false }],
    ["NoIndex , NoFollow", false, { index: false, follow: false }],
    ["none", false, { index: false, follow: false }],
    ["max-snippet:50", false, { index: true, follow: true }],
    ["index, follow", true, { index: false, follow: false }],
  ])("robots %p with noindex=%p", (robots, noindex, expected) => {
    expect(robotsFor({ ...seo, robots, noindex })).toEqual(expected);
  });

  it("narrows across sources: the site's noindex and a page's nofollow both apply", () => {
    expect(robotsFor({ ...seo, noindex: true }, seo)).toEqual({ index: false, follow: false });
    expect(robotsFor(seo, { ...seo, robots: "nofollow" })).toEqual({ index: true, follow: false });
  });

  it("allows when a source is missing (no site row yet)", () => {
    expect(robotsFor(null, seo)).toEqual({ index: true, follow: true });
    expect(robotsFor()).toEqual({ index: true, follow: true });
  });
});

describe("renderPageMetadata site-wide robots", () => {
  it("keeps every page out of the index when the site says noindex", async () => {
    mockResolveTenant.mockResolvedValue(active());
    mockGetPage.mockResolvedValue(makePage());
    mockGetSite.mockResolvedValue(makeSite({ seo: { ...makeSite().seo, noindex: true } }));

    const metadata = await renderPageMetadata([]);

    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(mockGetSite).toHaveBeenCalledWith("t1", HOST);
  });
});

describe("RenderPage", () => {
  it("calls notFound for an unknown host", async () => {
    mockResolveTenant.mockResolvedValue({ status: "unknown" });
    await expect(RenderPage({ segments: [] })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it("shows a neutral notice for an unavailable site and reads no content", async () => {
    mockResolveTenant.mockResolvedValue({
      status: "unavailable",
      tenant: makeTenant({ website_status: "unpublished" }),
      host: HOST,
    });
    const ui = await RenderPage({ segments: [] });
    render(ui);
    expect(screen.getByText("This website is unavailable")).toBeInTheDocument();
    expect(mockGetPage).not.toHaveBeenCalled();
  });

  it("calls notFound when the API has no published page", async () => {
    mockResolveTenant.mockResolvedValue(active());
    mockGetPage.mockResolvedValue(null);
    await expect(RenderPage({ segments: ["draft-page"] })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it("reads the page and site by host and picks the site's theme", async () => {
    mockResolveTenant.mockResolvedValue(active());
    mockGetPage.mockResolvedValue(makePage());
    mockGetSite.mockResolvedValue(makeSite());

    render(await RenderPage({ segments: ["about"] }));

    expect(mockGetPage).toHaveBeenCalledWith("t1", HOST, "about");
    expect(mockGetSite).toHaveBeenCalledWith("t1", HOST);
    expect(mockGetTheme).toHaveBeenCalledWith("default");
  });

  it("renders sections in position order with the host and page, skipping unrendered types", async () => {
    mockResolveTenant.mockResolvedValue(active());
    mockGetPage.mockResolvedValue(
      makePage({
        sections: [
          { id: "second", type: "hero", position: 1, props: {} },
          { id: "first", type: "hero", position: 0, props: {} },
          { id: "pending", type: "faq", position: 2, props: {} },
        ],
      }),
    );

    render(await RenderPage({ segments: [] }));

    const rendered = screen.getAllByTestId("section").map((el) => el.textContent);
    expect(rendered).toEqual([`first@${HOST}#p1`, `second@${HOST}#p1`]);
    expect(screen.getByTestId("nav")).toBeInTheDocument();
    expect(screen.getByTestId("footer")).toBeInTheDocument();
  });
});
