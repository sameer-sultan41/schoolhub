import { screen, within } from "@testing-library/react";
import { renderWithProviders } from "@/test-utils";
import { AppBreadcrumb } from "./app-breadcrumb";

let mockPathname = "/dashboard";

jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

/** The trail as a reader sees it, in order. */
function crumbLabels(): string[] {
  const list = screen.getByRole("list");
  return (
    within(list)
      .getAllByRole("listitem")
      // `textContent` on an Element is typed non-nullable under the DOM lib; the `?? ""`
      // it originally carried was dead.
      .map((item) => item.textContent)
  );
}

describe("AppBreadcrumb", () => {
  it("renders nothing on a module's own landing page", () => {
    mockPathname = "/students";
    const { container } = renderWithProviders(<AppBreadcrumb />);

    // One crumb is not a trail — the sidebar already says which module you are in.
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing at the dashboard root", () => {
    mockPathname = "/dashboard";
    const { container } = renderWithProviders(<AppBreadcrumb />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing at the site root", () => {
    mockPathname = "/";
    const { container } = renderWithProviders(<AppBreadcrumb />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a path no nav entry claims", () => {
    mockPathname = "/not-a-module/whatever";
    const { container } = renderWithProviders(<AppBreadcrumb />);

    expect(container).toBeEmptyDOMElement();
  });

  it("names its landmark so it is not just 'navigation' in the landmark list", () => {
    mockPathname = "/students/new";
    renderWithProviders(<AppBreadcrumb />);

    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
  });

  it("links the module and translates the known sub-route", () => {
    mockPathname = "/students/new";
    renderWithProviders(<AppBreadcrumb />);

    expect(screen.getByRole("link", { name: "Students" })).toHaveAttribute("href", "/students");
    expect(crumbLabels()).toEqual(["Students", "New"]);
  });

  it("marks the last crumb as the current page, and nothing before it", () => {
    mockPathname = "/timetable/rooms";
    renderWithProviders(<AppBreadcrumb />);

    expect(screen.getByText("Rooms")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Timetable" })).not.toHaveAttribute("aria-current");
  });

  it("renders an unrecognised segment as Details rather than a raw id", () => {
    mockPathname = "/students/8b1f0d0e-4c2a-4f5d-9a3b-6d7e8f901234/edit";
    renderWithProviders(<AppBreadcrumb />);

    expect(crumbLabels()).toEqual(["Students", "Details", "Edit"]);
    // The id is the middle crumb, so "current page" still belongs to the leaf.
    expect(screen.getByText("Edit")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Details")).not.toHaveAttribute("aria-current");
  });

  it("reuses each module's own wording for its sub-routes", () => {
    mockPathname = "/academics/promotions/batch-1";
    renderWithProviders(<AppBreadcrumb />);

    expect(crumbLabels()).toEqual(["Academics", "Promotions", "Details"]);
  });

  it("mirrors the separator icon under RTL rather than pointing back the way you came", () => {
    mockPathname = "/staff/import";
    const { container } = renderWithProviders(<AppBreadcrumb />);

    const separator = container.querySelector("svg");
    expect(separator).toHaveAttribute("aria-hidden", "true");
    expect(separator).toHaveClass("rtl:scale-x-[-1]");
  });
});
