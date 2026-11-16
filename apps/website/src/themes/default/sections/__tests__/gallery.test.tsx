import { render, screen } from "@testing-library/react";
import { getGallery } from "@/lib/content";
import { TEST_HOST, sectionProps } from "@/test-utils";
import { Gallery } from "../gallery";

jest.mock("@/lib/content", () => ({ getGallery: jest.fn() }));

const mockGetGallery = getGallery as jest.MockedFunction<typeof getGallery>;

function makeImage(overrides: Partial<Awaited<ReturnType<typeof getGallery>>[number]> = {}) {
  return {
    id: "g1",
    image_url: "https://api.test.invalid/api/v1/public/files/t1/f1",
    caption: "",
    alt_text: "Annual day celebration",
    album_slug: "annual-day",
    album_title: "Annual Day",
    ...overrides,
  };
}

describe("Gallery", () => {
  beforeEach(() => mockGetGallery.mockReset());

  it("renders each image with its alt text and caption", async () => {
    mockGetGallery.mockResolvedValue([makeImage({ caption: "Annual Day 2027" })]);

    render(await Gallery(sectionProps({ limit: 12 })));

    expect(screen.getByAltText("Annual day celebration")).toBeInTheDocument();
    expect(screen.getByText("Annual Day 2027")).toBeInTheDocument();
    expect(mockGetGallery).toHaveBeenCalledWith("t1", TEST_HOST, 12);
  });

  it("renders an image with no caption", async () => {
    mockGetGallery.mockResolvedValue([makeImage({ id: "g2", alt_text: "Sports day" })]);

    const { container } = render(await Gallery(sectionProps({})));

    expect(screen.getByAltText("Sports day")).toBeInTheDocument();
    expect(container.querySelector("figcaption")).toBeNull();
  });

  it("renders nothing when there are no images", async () => {
    mockGetGallery.mockResolvedValue([]);
    const result = await Gallery(sectionProps({}));
    expect(result).toBeNull();
  });

  it.each([0, 51])("renders nothing for a limit of %i (the theme allows 1-50)", async (limit) => {
    const result = await Gallery(sectionProps({ limit }));
    expect(result).toBeNull();
    expect(mockGetGallery).not.toHaveBeenCalled();
  });
});
