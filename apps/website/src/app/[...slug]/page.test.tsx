import { render, screen } from "@testing-library/react";
import { renderPageMetadata } from "../render-page";
import CmsPage, { generateMetadata } from "./page";

jest.mock("../render-page", () => ({
  renderPageMetadata: jest.fn(),
  RenderPage: ({ segments }: { segments: string[] }) => (
    <div data-testid="render-page">{segments.join("/")}</div>
  ),
}));

const mockRenderPageMetadata = renderPageMetadata as jest.MockedFunction<typeof renderPageMetadata>;

describe("CmsPage", () => {
  it("renders RenderPage with the resolved slug segments", async () => {
    const ui = await CmsPage({ params: Promise.resolve({ slug: ["about", "history"] }) });
    render(ui);
    expect(screen.getByTestId("render-page")).toHaveTextContent("about/history");
  });
});

describe("generateMetadata", () => {
  it("delegates to renderPageMetadata with the resolved slug", async () => {
    mockRenderPageMetadata.mockResolvedValue({ title: "About" });
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: ["about"] }) });
    expect(mockRenderPageMetadata).toHaveBeenCalledWith(["about"]);
    expect(metadata).toEqual({ title: "About" });
  });
});
