import { render, screen } from "@testing-library/react";
import { makeSection, makeTenant } from "@/test-utils";
import { getGallery } from "@/lib/content";
import { Gallery } from "./gallery";

jest.mock("@/lib/content", () => ({ getGallery: jest.fn() }));

const mockGetGallery = getGallery as jest.MockedFunction<typeof getGallery>;

describe("Gallery", () => {
  beforeEach(() => mockGetGallery.mockReset());

  it("renders each image with its caption", async () => {
    mockGetGallery.mockResolvedValue([
      {
        id: "g1",
        url: "https://cdn.example.com/photo.jpg",
        alt: "Annual day celebration",
        caption: "Annual Day 2027",
      },
    ]);

    render(await Gallery({ section: makeSection({}), tenant: makeTenant() }));

    expect(screen.getByAltText("Annual day celebration")).toBeInTheDocument();
    expect(screen.getByText("Annual Day 2027")).toBeInTheDocument();
  });

  it("renders nothing when there are no images", async () => {
    mockGetGallery.mockResolvedValue([]);
    const result = await Gallery({ section: makeSection({}), tenant: makeTenant() });
    expect(result).toBeNull();
  });
});
