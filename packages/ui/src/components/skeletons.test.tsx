import { render } from "@testing-library/react";
import {
  ChartSkeleton,
  DetailSkeleton,
  FormSkeleton,
  GridSkeleton,
  ScreenHeaderSkeleton,
  TableSkeleton,
} from "./skeletons";

const pulses = (container: HTMLElement) => container.querySelectorAll(".animate-pulse");

describe("skeletons", () => {
  it("renders a header, a rule and a subtitle for a screen header", () => {
    const { container } = render(<ScreenHeaderSkeleton />);
    expect(pulses(container)).toHaveLength(3);
  });

  it("renders a cell per column per row, plus a header row and the filter bar", () => {
    const { container } = render(<TableSkeleton rows={4} columns={3} />);
    // 2 filter controls + 3 header cells + 4 rows x 3 cells.
    expect(pulses(container)).toHaveLength(2 + 3 + 12);
  });

  it("renders one tile per requested count", () => {
    const { container } = render(<GridSkeleton count={6} />);
    expect(pulses(container)).toHaveLength(6);
  });

  it("draws bars of differing height rather than one flat block", () => {
    // A rectangle where a chart will be reads as a broken image. The heights are also
    // fixed rather than random: a skeleton that reshuffles on every render draws
    // attention to itself, which is the opposite of its job.
    const { container } = render(<ChartSkeleton />);
    const bars = Array.from(pulses(container)).slice(1);
    const heights = new Set(Array.from(bars, (bar) => bar.className));

    expect(bars.length).toBeGreaterThan(3);
    expect(heights.size).toBeGreaterThan(1);
  });

  it("renders stable output across renders", () => {
    const first = render(<ChartSkeleton />).container.innerHTML;
    const second = render(<ChartSkeleton />).container.innerHTML;
    expect(first).toBe(second);
  });

  it("shapes a detail screen as an identity block, tabs and fields", () => {
    const { container } = render(<DetailSkeleton />);
    // avatar + name + subtitle + 4 tabs + 6 fields x 2 lines.
    expect(pulses(container)).toHaveLength(3 + 4 + 12);
  });

  it("renders a label and a control per form field, plus the buttons", () => {
    const { container } = render(<FormSkeleton fields={4} />);
    expect(pulses(container)).toHaveLength(4 * 2 + 2);
  });

  it("hides every skeleton from assistive tech", () => {
    // The container that owns the loading state carries aria-busy; a screen reader should
    // hear one announcement, not a wall of unlabelled boxes.
    const { container } = render(<TableSkeleton rows={2} columns={2} />);
    for (const pulse of pulses(container)) {
      expect(pulse).toHaveAttribute("aria-hidden");
    }
  });
});
