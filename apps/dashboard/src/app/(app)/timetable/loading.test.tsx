import { render } from "@testing-library/react";
import Loading from "./loading";

describe("timetable loading", () => {
  it("renders the screen-header skeleton above a GridSkeleton", () => {
    const { container } = render(<Loading />);

    // ScreenHeaderSkeleton's own three bars, then the body skeleton's.
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(3);
    expect(container.querySelector('[class*="grid-cols-2"]')).toBeInTheDocument();
  });
});
