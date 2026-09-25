import { render, screen } from "@testing-library/react";
import { ToolbarHeading } from "../toolbar";

// A route with no place in MENU_SIDEBAR at all — same fixed-pathname convention as
// staff-toolbar.test.tsx, but deliberately unmapped: `getCurrentItem` resolves nothing,
// so with no explicit `title` prop either, the fallback has to carry the heading.
jest.mock("next/navigation", () => ({
  usePathname: () => "/some/unmapped/route",
}));

describe("ToolbarHeading", () => {
  it("falls back to 'Untitled' rather than an empty heading, when nothing else can name the page", () => {
    render(<ToolbarHeading />);

    expect(screen.getByRole("heading", { name: "Untitled" })).toBeInTheDocument();
  });

  it("an explicit title always wins over the menu-derived one", () => {
    render(<ToolbarHeading title="Staff" />);

    expect(screen.getByRole("heading", { name: "Staff" })).toBeInTheDocument();
  });
});
