import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { Pagination } from "./pagination";

/**
 * Every standard Tailwind palette family, so a literal colour utility is caught
 * regardless of which family it happens to use. Kept identical to button.test.tsx's copy.
 */
const LITERAL_COLOUR_UTILITY =
  /(?:bg|text|border)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(?:-\d{2,3})?\b|(?:bg|text|border)-\[#/;

/**
 * Deliberately English here, but only because a test needs SOME string — the point of
 * these being props at all is that nothing in the component supplies one.
 */
const labels = {
  label: "Pagination",
  previousLabel: "Previous",
  nextLabel: "Next",
  goToPageLabel: (page: number) => `Go to page ${page}`,
  morePagesLabel: "More pages",
};

function renderPagination(overrides: { page?: number; totalPages?: number } = {}) {
  const onPageChange = jest.fn();
  const result = render(
    <Pagination
      page={overrides.page ?? 6}
      totalPages={overrides.totalPages ?? 12}
      onPageChange={onPageChange}
      {...labels}
    />,
  );
  return { ...result, onPageChange };
}

/** The numbered buttons only, in DOM order — previous/next and the ellipsis excluded. */
function renderedPageNumbers(): string[] {
  return screen
    .getAllByRole("button")
    .map((button) => button.textContent)
    .filter((text) => /^\d+$/.test(text));
}

describe("Pagination", () => {
  it("renders only the windowed page set, not every page", () => {
    renderPagination({ page: 6, totalPages: 12 });

    expect(renderedPageNumbers()).toEqual(["4", "5", "6", "7", "8"]);
    expect(screen.queryByRole("button", { name: "Go to page 1" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Go to page 12" })).not.toBeInTheDocument();
  });

  it("names the nav from the caller's label rather than a hardcoded English one", () => {
    renderPagination();
    expect(screen.getByRole("navigation", { name: "Pagination" })).toBeInTheDocument();
  });

  it("marks the current page with aria-current and nothing else with it", () => {
    renderPagination({ page: 6, totalPages: 12 });

    expect(screen.getByRole("button", { name: "Go to page 6" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "Go to page 5" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("calls onPageChange with the page that was pressed", async () => {
    const { onPageChange } = renderPagination({ page: 6, totalPages: 12 });

    await userEvent.click(screen.getByRole("button", { name: "Go to page 8" }));

    expect(onPageChange).toHaveBeenCalledTimes(1);
    expect(onPageChange).toHaveBeenCalledWith(8);
  });

  it("steps one page at a time from Previous and Next", async () => {
    const { onPageChange } = renderPagination({ page: 6, totalPages: 12 });

    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(onPageChange).toHaveBeenLastCalledWith(5);

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onPageChange).toHaveBeenLastCalledWith(7);
  });

  it("disables Previous on the first page instead of hiding it", async () => {
    const { onPageChange } = renderPagination({ page: 1, totalPages: 12 });

    const previous = screen.getByRole("button", { name: "Previous" });
    expect(previous).toBeInTheDocument();
    expect(previous).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();

    await userEvent.click(previous);
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("disables Next on the last page instead of hiding it", async () => {
    const { onPageChange } = renderPagination({ page: 12, totalPages: 12 });

    const next = screen.getByRole("button", { name: "Next" });
    expect(next).toBeInTheDocument();
    expect(next).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();

    await userEvent.click(next);
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("renders an ellipsis on each side the window is truncated, announced with morePagesLabel", () => {
    renderPagination({ page: 6, totalPages: 12 });
    // Pages 1–3 and 9–12 are both out of the window, so both gaps are marked.
    expect(screen.getAllByText("More pages")).toHaveLength(2);
  });

  it("renders no ellipsis when the window reaches an end", () => {
    renderPagination({ page: 1, totalPages: 12 });
    // Window is 1–5: nothing skipped before it, pages 6–12 skipped after it.
    expect(screen.getAllByText("More pages")).toHaveLength(1);
  });

  it("renders no ellipsis at all when every page fits", () => {
    renderPagination({ page: 2, totalPages: 4 });

    expect(renderedPageNumbers()).toEqual(["1", "2", "3", "4"]);
    expect(screen.queryByText("More pages")).not.toBeInTheDocument();
  });

  it("renders nothing when there is nothing to paginate", () => {
    const { container } = renderPagination({ page: 1, totalPages: 0 });
    expect(container).toBeEmptyDOMElement();
  });

  it("mirrors both chevrons under RTL rather than pointing them the wrong way in Urdu", () => {
    renderPagination();

    expect(screen.getByRole("button", { name: "Previous" }).querySelector("svg")).toHaveClass(
      "rtl:rotate-180",
    );
    expect(screen.getByRole("button", { name: "Next" }).querySelector("svg")).toHaveClass(
      "rtl:rotate-180",
    );
  });

  it("takes only the width it needs, so DataTable's footer keeps it beside the row summary", () => {
    renderPagination();
    const pager = screen.getByRole("navigation", { name: "Pagination" });

    // shadcn's own root is `w-full justify-center`, which is right for a standalone pager
    // centred under a page of content and wrong in the footer this one actually sits in:
    // a full-width child of that wrapping flex row claims a line of its own and drops the
    // pager below the "11 - 20 of 243" it is meant to sit next to.
    expect(pager.className).not.toContain("w-full");
    expect(pager.className).toContain("justify-center");
  });

  it("distinguishes the current page by more than colour, from tokens only", () => {
    renderPagination({ page: 6, totalPages: 12 });

    const current = screen.getByRole("button", { name: "Go to page 6" });
    const other = screen.getByRole("button", { name: "Go to page 5" });

    // Weight and border, not just fill — a reader who cannot separate the colours can
    // still find their place.
    expect(current).toHaveClass("font-bold");
    expect(current.className).toContain("border");
    expect(other).not.toHaveClass("font-bold");

    expect(current.className).not.toMatch(LITERAL_COLOUR_UTILITY);
    expect(other.className).not.toMatch(LITERAL_COLOUR_UTILITY);
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = renderPagination({ page: 6, totalPages: 12 });
    expect(await axe(container)).toHaveNoViolations();
  });
});
