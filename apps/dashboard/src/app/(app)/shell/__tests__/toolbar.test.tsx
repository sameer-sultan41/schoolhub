import { render, screen } from "@testing-library/react";
import { usePathname } from "next/navigation";

import { ToolbarHeading } from "../toolbar";

// A jest.fn() (not a plain arrow function) so individual tests can point it at a real
// mapped route to prove the menu-derived icon stays scoped to `inline` — see the two
// tests at the bottom.
jest.mock("next/navigation", () => ({
  usePathname: jest.fn(),
}));

const mockUsePathname = usePathname as jest.MockedFunction<typeof usePathname>;

describe("ToolbarHeading", () => {
  beforeEach(() => {
    // An unmapped route by default: `getCurrentItem` resolves nothing, so with no
    // explicit `title` prop either, the fallback has to carry the heading.
    mockUsePathname.mockReturnValue("/some/unmapped/route");
  });

  it("falls back to 'Untitled' rather than an empty heading, when nothing else can name the page", () => {
    render(<ToolbarHeading />);

    expect(screen.getByRole("heading", { name: "Untitled" })).toBeInTheDocument();
  });

  it("an explicit title always wins over the menu-derived one", () => {
    render(<ToolbarHeading title="Staff" />);

    expect(screen.getByRole("heading", { name: "Staff" })).toBeInTheDocument();
  });

  it("shows no menu icon on a route the menu DOES map, when inline is false", () => {
    // "/students" is a real MENU_SIDEBAR entry (GraduationCap) — proves the icon isn't
    // just absent because nothing matched.
    mockUsePathname.mockReturnValue("/students");

    const { container } = render(<ToolbarHeading />);

    expect(screen.getByRole("heading", { name: "Students" })).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });

  it("shows the route's menu icon once inline is true", () => {
    mockUsePathname.mockReturnValue("/students");

    const { container } = render(<ToolbarHeading inline />);

    expect(screen.getByRole("heading", { name: "Students" })).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
