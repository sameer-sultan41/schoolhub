import { render } from "@testing-library/react";
import Loading from "./loading";

describe("students/[studentId] loading", () => {
  it("renders the screen-header skeleton above a DetailSkeleton", () => {
    const { container } = render(<Loading />);

    // ScreenHeaderSkeleton's own three bars, then the body skeleton's.
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(3);
    expect(container.querySelector('[class*="rounded-full"]')).toBeInTheDocument();
  });
});
