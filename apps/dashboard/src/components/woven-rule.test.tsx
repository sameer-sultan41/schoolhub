import { render } from "@testing-library/react";
import { WovenRule } from "./woven-rule";

describe("WovenRule", () => {
  it("renders a decorative, hidden-from-assistive-tech svg", () => {
    const { container } = render(<WovenRule />);
    const svg = container.querySelector("svg");

    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelectorAll("path")).toHaveLength(2);
  });

  it("merges a caller-supplied className onto the default classes", () => {
    const { container } = render(<WovenRule className="mt-4" />);
    const svg = container.querySelector("svg");

    expect(svg?.getAttribute("class")).toContain("mt-4");
    expect(svg?.getAttribute("class")).toContain("h-3");
  });
});
