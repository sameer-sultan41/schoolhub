import { render, screen } from "@testing-library/react";
import { usePathname } from "next/navigation";

import { ToolbarHeading } from "../toolbar";

// jest.fn() so a test can point it at a mapped route.
jest.mock("next/navigation", () => ({
  usePathname: jest.fn(),
}));

const mockUsePathname = usePathname as jest.MockedFunction<typeof usePathname>;

describe("ToolbarHeading", () => {
  beforeEach(() => {
    // Unmapped by default, so with no title prop the fallback names the heading.
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
    // A real menu entry, so a missing icon means gating, not "nothing matched".
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
