import { render } from "@testing-library/react";
import {
  DetailRouteLoading,
  FormRouteLoading,
  GridRouteLoading,
  TableRouteLoading,
} from "@/components/route-loading";

/** ScreenHeaderSkeleton's subtitle bar — the handle for "the header block is above this". */
const HEADER_BAR = '[class*="w-72"]';
/** TableSkeleton's header row. Not `border-b`, which `border-border` also matches. */
const TABLE_HEAD_ROW = '[class*="bg-surface-sunken"]';

describe("TableRouteLoading", () => {
  it("draws the header block above the table", () => {
    const { container } = render(<TableRouteLoading columns={4} />);

    expect(container.querySelector(HEADER_BAR)).toBeInTheDocument();
    expect(container.querySelector(TABLE_HEAD_ROW)).toBeInTheDocument();
  });

  it("gives the header row one cell per column the screen asked for", () => {
    // The count is the only thing a route passes, so it is the only thing worth proving
    // arrives: a table that loads four columns wide and lands seven wide jumps.
    const { container } = render(<TableRouteLoading columns={7} />);

    expect(container.querySelector(TABLE_HEAD_ROW)?.children).toHaveLength(7);
  });
});

describe("DetailRouteLoading", () => {
  it("draws the header block above the avatar, tab strip and field pairs", () => {
    const { container } = render(<DetailRouteLoading />);

    expect(container.querySelector(HEADER_BAR)).toBeInTheDocument();
    expect(container.querySelector('[class*="rounded-full"]')).toBeInTheDocument();
  });
});

describe("FormRouteLoading", () => {
  it("draws the header block above the form", () => {
    const { container } = render(<FormRouteLoading fields={2} />);

    expect(container.querySelector(HEADER_BAR)).toBeInTheDocument();
    expect(container.querySelectorAll('[class*="h-10"]').length).toBeGreaterThan(0);
  });

  it("lays out one field pair per field the screen asked for", () => {
    const { container } = render(<FormRouteLoading fields={14} />);

    expect(container.querySelector('[class*="sm:grid-cols-2"]')?.children).toHaveLength(14);
  });
});

describe("GridRouteLoading", () => {
  it("draws a week's worth of cells under the header, not GridSkeleton's default four", () => {
    const { container } = render(<GridRouteLoading />);

    expect(container.querySelector(HEADER_BAR)).toBeInTheDocument();
    expect(container.querySelector('[class*="xl:grid-cols-4"]')?.children).toHaveLength(8);
  });
});
