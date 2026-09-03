import { render } from "@testing-library/react";
import Loading from "./loading";

describe("(app) Loading", () => {
  it("renders a title skeleton and four stat-tile skeletons", () => {
    const { container } = render(<Loading />);
    // 2 title/subtitle skeletons + 4 tile skeletons.
    expect(container.querySelectorAll('[class*="animate-pulse"]')).toHaveLength(6);
  });
});
