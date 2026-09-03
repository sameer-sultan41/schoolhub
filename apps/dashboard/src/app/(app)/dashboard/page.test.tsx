import { render, screen } from "@testing-library/react";
import DashboardPage from "./page";

jest.mock("@/features/dashboard/dashboard-summary", () => ({
  DashboardSummary: () => <div data-testid="dashboard-summary" />,
}));

// getTranslations (next-intl/server) has no working fix under the current
// next/jest setup — it resolves a client-guarded build under Jest regardless
// of environment, since next/jest sets no react-server export condition. Mock
// it directly rather than fighting that; the strings mirror messages/en.json's
// `dashboard.title`/`dashboard.summary` verbatim.
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
  it("renders the heading, summary, exactly one WovenRule, and the summary widget", async () => {
    const ui = await DashboardPage();
    const { container } = render(ui);

    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Today at a glance")).toBeInTheDocument();
    expect(container.querySelectorAll("svg[viewBox='0 0 200 12']")).toHaveLength(1);
    expect(screen.getByTestId("dashboard-summary")).toBeInTheDocument();
  });

  it("sets the page title via metadata", async () => {
    const { metadata } = await import("./page");
    expect(metadata.title).toBe("Dashboard");
  });
});
