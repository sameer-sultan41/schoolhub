import { render, screen } from "@testing-library/react";
import { notFound } from "next/navigation";
import { getNewsPost, getSite } from "@/lib/content";
import { resolveTenant } from "@/lib/tenant";
import { makeNewsPostDetail, makeTenant } from "@/test-utils";
import NewsPostPage, { generateMetadata } from "../page";

jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
jest.mock("@/lib/content", () => ({ getNewsPost: jest.fn(), getSite: jest.fn() }));
jest.mock("@/lib/tenant", () => ({
  resolveTenant: jest.fn(),
  canonicalOrigin: jest.requireActual("@/lib/tenant").canonicalOrigin,
}));
jest.mock("@/themes", () => ({
  getTheme: () => ({
    Navigation: () => <nav data-testid="nav" />,
    Footer: () => <footer data-testid="footer" />,
  }),
}));

const mockGetNewsPost = getNewsPost as jest.MockedFunction<typeof getNewsPost>;
const mockGetSite = getSite as jest.MockedFunction<typeof getSite>;
const mockResolveTenant = resolveTenant as jest.MockedFunction<typeof resolveTenant>;
const mockNotFound = notFound as jest.MockedFunction<typeof notFound>;

const HOST = "cityschool.schoolhub.pk";
const params = (slug = "sports-day") => ({ params: Promise.resolve({ slug }) });

beforeEach(() => {
  mockNotFound.mockClear();
  mockGetNewsPost.mockReset();
  mockGetSite.mockReset().mockResolvedValue(null);
  mockResolveTenant.mockReset().mockResolvedValue({
    status: "active",
    tenant: makeTenant(),
    host: HOST,
  });
});

describe("NewsPostPage", () => {
  it("is a 404 when the API returns no post", async () => {
    mockGetNewsPost.mockResolvedValue(null);
    await expect(NewsPostPage(params("missing"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockGetNewsPost).toHaveBeenCalledWith("t1", HOST, "missing");
  });

  it("is a 404 for an unknown host", async () => {
    mockResolveTenant.mockResolvedValue({ status: "unknown" });
    await expect(NewsPostPage(params())).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockGetNewsPost).not.toHaveBeenCalled();
  });

  it("shows the neutral notice for an unavailable site", async () => {
    mockResolveTenant.mockResolvedValue({
      status: "unavailable",
      tenant: makeTenant(),
      host: HOST,
    });
    render(await NewsPostPage(params()));
    expect(screen.getByText("This website is unavailable")).toBeInTheDocument();
    expect(mockGetNewsPost).not.toHaveBeenCalled();
  });

  it("renders the post in the site chrome with its rich-text body", async () => {
    mockGetNewsPost.mockResolvedValue(
      makeNewsPostDetail({ cover_image_url: "https://api.test.invalid/api/v1/public/files/t1/c" }),
    );
    const { container } = render(await NewsPostPage(params()));

    expect(screen.getByRole("heading", { level: 1, name: "Sports day" })).toBeInTheDocument();
    expect(screen.getByText("Every house took part.")).toBeInTheDocument();
    expect(container.querySelector("time")).toHaveAttribute("datetime", "2027-03-01T05:00:00Z");
    expect(container.querySelector("img")).not.toBeNull();
    expect(screen.getByTestId("nav")).toBeInTheDocument();
    expect(screen.getByTestId("footer")).toBeInTheDocument();
  });

  it("emits NewsArticle structured data a title cannot break out of", async () => {
    const title = "Results</script><script>window.pwned = 1</script>";
    mockGetNewsPost.mockResolvedValue(makeNewsPostDetail({ title, published_at: null }));
    const { container } = render(await NewsPostPage(params()));

    const scripts = container.querySelectorAll("script");
    expect(scripts).toHaveLength(1);
    const data = JSON.parse(scripts[0]?.textContent ?? "") as Record<string, unknown>;
    expect(data).toMatchObject({
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      headline: title,
      dateModified: "2027-03-02T05:00:00Z",
      mainEntityOfPage: `https://${HOST}/news/sports-day`,
      publisher: { "@type": "Organization", name: "City School" },
    });
    expect(data).not.toHaveProperty("datePublished");
    expect(container.querySelector("time")).toBeNull();
  });
});

describe("generateMetadata", () => {
  it("builds article metadata on the canonical origin", async () => {
    mockResolveTenant.mockResolvedValue({
      status: "active",
      tenant: makeTenant({ custom_domain: "www.cityschool.edu.pk" }),
      host: HOST,
    });
    mockGetNewsPost.mockResolvedValue(makeNewsPostDetail());

    const metadata = await generateMetadata(params());

    expect(metadata.title).toBe("Sports day");
    expect(metadata.description).toBe("A day of races.");
    expect(metadata.alternates).toEqual({
      canonical: "https://www.cityschool.edu.pk/news/sports-day",
    });
    expect(metadata.openGraph).toMatchObject({
      type: "article",
      publishedTime: "2027-03-01T05:00:00Z",
    });
  });

  it("is unindexed for a missing post or an unavailable site", async () => {
    mockGetNewsPost.mockResolvedValue(null);
    await expect(generateMetadata(params())).resolves.toMatchObject({
      robots: { index: false, follow: false },
    });

    mockResolveTenant.mockResolvedValue({ status: "unknown" });
    await expect(generateMetadata(params())).resolves.toEqual({
      title: "Not available",
      robots: { index: false, follow: false },
    });
  });
});
