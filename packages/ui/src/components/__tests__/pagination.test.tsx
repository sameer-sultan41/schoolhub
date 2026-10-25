import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { CursorPagination, Pagination, type CursorPaginationProps } from "../pagination";

function renderCursor(overrides: Partial<CursorPaginationProps> = {}) {
  const props: CursorPaginationProps = {
    hasPrevious: false,
    hasNext: true,
    onPrevious: jest.fn(),
    onNext: jest.fn(),
    label: "Records pages",
    previousLabel: "Previous page",
    nextLabel: "Next page",
    ...overrides,
  };
  return { props, ...render(<CursorPagination {...props} />) };
}

describe("CursorPagination", () => {
  it("names the nav and both arrows with the labels it was given", () => {
    renderCursor();

    const pager = screen.getByRole("navigation", { name: "Records pages" });
    expect(within(pager).getByRole("button", { name: "Previous page" })).toBeInTheDocument();
    expect(within(pager).getByRole("button", { name: "Next page" })).toBeInTheDocument();
  });

  it("shows no page numbers: a cursor never knows where it is", () => {
    renderCursor({ hasPrevious: true });

    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("disables Previous on the first page and Next on the last", () => {
    const { rerender, props } = renderCursor({ hasPrevious: false, hasNext: true });
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();

    rerender(<CursorPagination {...props} hasPrevious hasNext={false} />);
    expect(screen.getByRole("button", { name: "Previous page" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("keeps both arrows, disabled, on a single page rather than hiding itself", () => {
    renderCursor({ hasPrevious: false, hasNext: false });

    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("calls onPrevious and onNext for their own arrow only", async () => {
    const onPrevious = jest.fn();
    const onNext = jest.fn();
    renderCursor({ hasPrevious: true, hasNext: true, onPrevious, onNext });

    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrevious).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("does not call a disabled arrow's callback", async () => {
    const onPrevious = jest.fn();
    renderCursor({ hasPrevious: false, onPrevious });

    await userEvent.click(screen.getByRole("button", { name: "Previous page" }));

    expect(onPrevious).not.toHaveBeenCalled();
  });

  it("mirrors both chevrons under RTL, so Previous points to the start", () => {
    const { container } = render(
      <div dir="rtl">
        <CursorPagination
          hasPrevious
          hasNext
          onPrevious={jest.fn()}
          onNext={jest.fn()}
          label="Records pages"
          previousLabel="Previous page"
          nextLabel="Next page"
        />
      </div>,
    );

    const chevrons = container.querySelectorAll("svg");
    expect(chevrons).toHaveLength(2);
    chevrons.forEach((chevron) => {
      expect(chevron).toHaveAttribute("aria-hidden", "true");
      expect(chevron).toHaveClass("rtl:rotate-180");
    });
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = renderCursor({ hasPrevious: true });

    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("Pagination", () => {
  const labels = {
    label: "Pagination",
    previousLabel: "Previous page",
    nextLabel: "Next page",
    goToPageLabel: (page: number) => `Go to page ${page}`,
    morePagesLabel: "More pages",
  };

  it("steps one page back and forward with the same arrows CursorPagination uses", async () => {
    const onPageChange = jest.fn();
    render(<Pagination page={3} totalPages={8} onPageChange={onPageChange} {...labels} />);

    await userEvent.click(screen.getByRole("button", { name: "Previous page" }));
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));

    expect(onPageChange.mock.calls).toEqual([[2], [4]]);
  });

  it("disables the arrows at the ends", () => {
    const { rerender } = render(
      <Pagination page={1} totalPages={3} onPageChange={jest.fn()} {...labels} />,
    );
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();

    rerender(<Pagination page={3} totalPages={3} onPageChange={jest.fn()} {...labels} />);
    expect(screen.getByRole("button", { name: "Previous page" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("renders nothing when there are no pages", () => {
    render(<Pagination page={1} totalPages={0} onPageChange={jest.fn()} {...labels} />);

    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});
