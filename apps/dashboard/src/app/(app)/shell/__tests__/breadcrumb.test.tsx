import { render, screen } from "@testing-library/react";

import { Breadcrumb } from "../breadcrumb";

// The one breadcrumb rendering in the app now lives in the header, on every route — see
// header.tsx's own comment. `usePathname` drives `useMenu`'s traversal of `MENU_SIDEBAR`
// (menu-config.ts), so each test fixes the route it cares about.
let pathname = "/staff";
jest.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

describe("Breadcrumb", () => {
  it("never warns on a duplicate key, even when Home and the active leaf share a path", () => {
    // On /dashboard itself, HOME_CRUMB and the active "Light Sidebar" leaf both point at
    // "/dashboard" — a real collision the first version of this component keyed on path.
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    pathname = "/dashboard";

    render(<Breadcrumb />);

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("always leads with Home, linked, even for a top-level page", () => {
    pathname = "/staff";
    render(<Breadcrumb />);

    const home = screen.getByRole("link", { name: "Home" });
    expect(home).toHaveAttribute("href", "/dashboard");
  });

  it("renders the current page as plain text, not a link to itself", () => {
    pathname = "/staff";
    render(<Breadcrumb />);

    expect(screen.getByText("Staff")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Staff" })).not.toBeInTheDocument();
  });

  it("links every crumb before the current page", () => {
    pathname = "/dashboard";
    render(<Breadcrumb />);

    // MENU_SIDEBAR nests /dashboard under a "Dashboards" parent with no path of its own.
    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByText("Dashboards")).toBeInTheDocument();
    expect(screen.getByText("Light Sidebar")).toBeInTheDocument();
  });

  it("renders nothing on a route with no place in the menu", () => {
    pathname = "/some/unmapped/route";
    const { container } = render(<Breadcrumb />);

    expect(container).toBeEmptyDOMElement();
  });
});
