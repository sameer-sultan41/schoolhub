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

  it("puts the band full width above a two-column grid of the slower panels", async () => {
    const ui = await DashboardPage();
    const { container } = render(ui, { wrapper: PreferencesTestWrapper });

    const grid = container.querySelector(".lg\\:grid-cols-2");
    expect(grid).not.toBeNull();
    expect(grid?.contains(screen.getByTestId("now-band"))).toBe(false);
    expect(grid?.contains(screen.getByTestId("teacher-load"))).toBe(true);
    expect(grid?.contains(screen.getByTestId("quick-actions"))).toBe(true);
  });

  it("sets the page title via metadata", async () => {
    const { metadata } = await import("./page");
    expect(metadata.title).toBe("Dashboard");
  });
});
