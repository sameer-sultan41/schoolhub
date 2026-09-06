import { render } from "@testing-library/react";
import Loading from "./loading";

describe("students/[studentId]/edit loading", () => {
  it("renders the screen-header skeleton above a FormSkeleton", () => {
    const { container } = render(<Loading />);

    // ScreenHeaderSkeleton's own three bars, then the body skeleton's.
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(3);
    expect(container.querySelectorAll('[class*="h-10"]').length).toBeGreaterThan(0);
  });
});
