import { render } from "@testing-library/react";
import Loading from "./loading";

describe("dashboard loading", () => {
  it("shape-matches the home screen: header, band, panel grid, stat row", () => {
    const { container } = render(<Loading />);

    // Header (3 bars) + band (1) + four chart skeletons (1 label + 6 bars each) + eight
    // stat tiles: the point is that every region the page will fill has a placeholder of
    // its own, not one grey rectangle standing in for all of them.
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(30);
    expect(container.querySelectorAll(".lg\\:grid-cols-2")).toHaveLength(1);
  });
});
