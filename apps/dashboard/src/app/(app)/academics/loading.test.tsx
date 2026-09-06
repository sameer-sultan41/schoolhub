import { render } from "@testing-library/react";
import Loading from "./loading";

describe("academics loading", () => {
  it("renders the screen-header skeleton above a TableSkeleton", () => {
    const { container } = render(<Loading />);

    // ScreenHeaderSkeleton's own three bars, then the body skeleton's.
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(3);
    expect(container.querySelectorAll('[class*="border-b"]').length).toBeGreaterThan(0);
  });
});
