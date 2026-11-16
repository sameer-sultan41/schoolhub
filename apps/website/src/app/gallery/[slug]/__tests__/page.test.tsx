import { render, screen } from "@testing-library/react";
import { notFound } from "next/navigation";
import { getAlbum, getSite } from "@/lib/content";
import { resolveTenant } from "@/lib/tenant";
import { makeAlbumDetail, makeGalleryItem, makeTenant } from "@/test-utils";
import AlbumPage, { generateMetadata } from "../page";

jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
jest.mock("@/lib/content", () => ({ getAlbum: jest.fn(), getSite: jest.fn() }));
jest.mock("@/lib/tenant", () => ({
  resolveTenant: jest.fn(),
  canonicalOrigin: jest.requireActual("@/lib/tenant").canonicalOrigin,
}));
jest.mock("@/themes", () => ({
  getTheme: () => ({ Navigation: () => <nav />, Footer: () => <footer /> }),
}));

const mockGetAlbum = getAlbum as jest.MockedFunction<typeof getAlbum>;
const mockGetSite = getSite as jest.MockedFunction<typeof getSite>;
const mockResolveTenant = resolveTenant as jest.MockedFunction<typeof resolveTenant>;
const mockNotFound = notFound as jest.MockedFunction<typeof notFound>;

const HOST = "cityschool.schoolhub.pk";
const params = (slug = "science-fair") => ({ params: Promise.resolve({ slug }) });

beforeEach(() => {
  mockNotFound.mockClear();
  mockGetAlbum.mockReset();
  mockGetSite.mockReset().mockResolvedValue(null);
  mockResolveTenant.mockReset().mockResolvedValue({
    status: "active",
    tenant: makeTenant(),
    host: HOST,
  });
});

describe("AlbumPage", () => {
  it("is a 404 when the API returns no album", async () => {
    mockGetAlbum.mockResolvedValue(null);
    await expect(AlbumPage(params("missing"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockGetAlbum).toHaveBeenCalledWith("t1", HOST, "missing");
  });

  it("is a 404 for an unknown host and a notice for an unavailable site", async () => {
    mockResolveTenant.mockResolvedValue({ status: "unknown" });
    await expect(AlbumPage(params())).rejects.toThrow("NEXT_NOT_FOUND");

    mockResolveTenant.mockResolvedValue({
      status: "unavailable",
      tenant: makeTenant(),
      host: HOST,
    });
    render(await AlbumPage(params()));
    expect(screen.getByText("This website is unavailable")).toBeInTheDocument();
  });

  it("renders images in position order and a video as a link to its host", async () => {
    mockGetAlbum.mockResolvedValue(
      makeAlbumDetail({
        description: "Our young scientists.",
        item_count: 3,
        items: [
          makeGalleryItem({ id: "i2", position: 2, alt_text: "Second", caption: "Robots" }),
          makeGalleryItem({ id: "i1", position: 1, alt_text: "First" }),
          makeGalleryItem({
            id: "v1",
            position: 3,
            media_type: "video_embed",
            image_url: null,
            embed_url: "https://www.youtube.com/watch?v=abc",
            alt_text: "",
          }),
        ],
      }),
    );
    render(await AlbumPage(params()));

    expect(screen.getByRole("heading", { level: 1, name: "Science fair" })).toBeInTheDocument();
    expect(screen.getByText("Our young scientists.")).toBeInTheDocument();
    const images = screen.getAllByRole("img");
    expect(images.map((image) => image.getAttribute("alt"))).toEqual(["First", "Second"]);
    expect(screen.getByText("Robots")).toBeInTheDocument();
    const video = screen.getByRole("link", { name: "Watch video" });
    expect(video).toHaveAttribute("href", "https://www.youtube.com/watch?v=abc");
    expect(video).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByText(/Showing/)).toBeNull();
  });

  it("drops a video whose URL is not https", async () => {
    mockGetAlbum.mockResolvedValue(
      makeAlbumDetail({
        item_count: 1,
        items: [makeGalleryItem({ image_url: null, embed_url: "javascript:alert(1)" })],
      }),
    );
    render(await AlbumPage(params()));
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says how many items there are when the album holds more than the API sends", async () => {
    mockGetAlbum.mockResolvedValue(
      makeAlbumDetail({ item_count: 250, items: [makeGalleryItem()] }),
    );
    render(await AlbumPage(params()));
    expect(screen.getByText("Showing 1 of 250 items")).toBeInTheDocument();
  });
});

describe("generateMetadata", () => {
  it("titles the album on its canonical URL", async () => {
    mockGetAlbum.mockResolvedValue(makeAlbumDetail({ description: "Projects and prizes." }));
    const metadata = await generateMetadata(params());

    expect(metadata.title).toBe("Science fair");
    expect(metadata.description).toBe("Projects and prizes.");
    expect(metadata.alternates).toEqual({ canonical: `https://${HOST}/gallery/science-fair` });
  });

  it("is unindexed for a missing album or an unavailable site", async () => {
    mockGetAlbum.mockResolvedValue(null);
    await expect(generateMetadata(params())).resolves.toMatchObject({
      robots: { index: false, follow: false },
    });
    mockResolveTenant.mockResolvedValue({ status: "unknown" });
    await expect(generateMetadata(params())).resolves.toMatchObject({ title: "Not available" });
  });
});
