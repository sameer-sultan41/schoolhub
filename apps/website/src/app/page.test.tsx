import { render, screen } from "@testing-library/react";
import { renderPageMetadata } from "./render-page";
import HomePage, { generateMetadata } from "./page";

jest.mock("./render-page", () => ({
  renderPageMetadata: jest.fn(),
  RenderPage: ({ segments }: { segments: string[] }) => (
    <div data-testid="render-page">segments:{segments.length}</div>
  ),
}));

const mockRenderPageMetadata = renderPageMetadata as jest.MockedFunction<typeof renderPageMetadata>;

describe("HomePage", () => {
  it("renders RenderPage with no segments", () => {
    render(<HomePage />);
    expect(screen.getByTestId("render-page")).toHaveTextContent("segments:0");
  });
});

describe("generateMetadata", () => {
  it("delegates to renderPageMetadata with no segments", async () => {
    mockRenderPageMetadata.mockResolvedValue({ title: "Home" });
    const metadata = await generateMetadata();
    expect(mockRenderPageMetadata).toHaveBeenCalledWith([]);
    expect(metadata).toEqual({ title: "Home" });
  });
});
