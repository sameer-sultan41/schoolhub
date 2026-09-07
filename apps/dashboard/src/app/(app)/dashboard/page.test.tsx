import { render, screen } from "@testing-library/react";
import { PreferencesTestWrapper } from "@/test-utils";
import DashboardPage from "./page";

jest.mock("@/features/dashboard/now-band", () => ({
  NowBand: () => <div data-testid="now-band" />,
}));
jest.mock("@/features/dashboard/teacher-load-chart", () => ({
  TeacherLoadChart: () => <div data-testid="teacher-load" />,
}));
jest.mock("@/features/dashboard/pending-work-panel", () => ({
  PendingWorkPanel: () => <div data-testid="pending-work" />,
}));
jest.mock("@/features/dashboard/capacity-chart", () => ({
  CapacityChart: () => <div data-testid="capacity" />,
}));
jest.mock("@/features/dashboard/quick-actions", () => ({
  QuickActions: () => <div data-testid="quick-actions" />,
}));
jest.mock("@/features/dashboard/school-shape-panel", () => ({
  SchoolShapePanel: () => <div data-testid="school-shape" />,
}));

// getTranslations (next-intl/server) has no working fix under the current next/jest
// setup — it resolves a client-guarded build under Jest regardless of environment, since
// next/jest sets no react-server export condition. Mock it directly rather than fighting
// that; the strings mirror messages/en.json's `dashboard.title`/`dashboard.summary`
// verbatim.
jest.mock("next-intl/server", () => ({
  getTranslations: () =>
    Promise.resolve(
      (key: string) =>
        ({
          title: "Dashboard",
          summary: "Today at a glance",
        })[key],
    ),
}));

describe("DashboardPage", () => {
  it("renders the heading, exactly one WovenRule, and every panel", async () => {
    const ui = await DashboardPage();
    const { container } = render(ui, { wrapper: PreferencesTestWrapper });

    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Today at a glance")).toBeInTheDocument();
    // The screen's one signature element, and only one — `ScreenHeader` owns it now.
    expect(container.querySelectorAll("svg[viewBox='0 0 200 12']")).toHaveLength(1);

    for (const panel of [
      "now-band",
      "teacher-load",
      "pending-work",
      "capacity",
      "quick-actions",
      "school-shape",
    ]) {
      expect(screen.getByTestId(panel)).toBeInTheDocument();
    }
  });

  it("keeps the band and the head counts full width, and pairs each chart with a panel", async () => {
    const ui = await DashboardPage();
    const { container } = render(ui, { wrapper: PreferencesTestWrapper });

    // Two grids, each two-thirds chart and one-third panel. This used to be one
    // `lg:grid-cols-2` holding both charts; the screen was recomposed into hero,
    // figures, then panels, and the assertion had not moved with it.
    const grids = [...container.querySelectorAll(".lg\\:grid-cols-3")];
    expect(grids).toHaveLength(2);

    // The band answers "what is happening now" and the counts "how big is this
    // school" — both are read across, so neither is boxed into a column.
    for (const fullWidth of ["now-band", "school-shape"]) {
      const node = screen.getByTestId(fullWidth);
      expect(grids.some((grid) => grid.contains(node))).toBe(false);
    }

    const [teaching, capacity] = grids;
    expect(teaching?.contains(screen.getByTestId("teacher-load"))).toBe(true);
    expect(teaching?.contains(screen.getByTestId("pending-work"))).toBe(true);
    expect(capacity?.contains(screen.getByTestId("capacity"))).toBe(true);
    expect(capacity?.contains(screen.getByTestId("quick-actions"))).toBe(true);

    // The chart takes the wide side of its own grid, not the panel beside it.
    for (const grid of grids) {
      expect(grid.querySelectorAll(".lg\\:col-span-2")).toHaveLength(1);
    }
  });

  it("sets the page title via metadata", async () => {
    const { metadata } = await import("./page");
    expect(metadata.title).toBe("Dashboard");
  });
});
