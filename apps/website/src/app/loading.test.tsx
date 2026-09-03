import { render } from "@testing-library/react";
import Loading from "./loading";

describe("Loading", () => {
  it("renders a skeleton placeholder", () => {
    const { container } = render(<Loading />);
    expect(container.querySelectorAll('[class*="animate-pulse"]').length).toBeGreaterThan(0);
  });
});
