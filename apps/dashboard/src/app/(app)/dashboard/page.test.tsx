import { render, screen } from "@testing-library/react";
import DashboardPage from "./page";

// getTranslations (next-intl/server) has no working fix under the current next/jest
// setup — it resolves a client-guarded build under Jest regardless of environment, since
// next/jest sets no react-server export condition. Mock it directly rather than fighting
// that; the strings mirror messages/en.json's `dashboard.title`/`dashboard.summary`
// verbatim.
jest.mock("next-intl/server", () => ({
  getTranslations: () =>
    Promise.resolve((key: string) => ({ title: "Dashboard", summary: "Today at a glance" })[key]),
}));

describe("DashboardPage", () => {
  it("renders the placeholder heading and summary", async () => {
    render(await DashboardPage());
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Today at a glance")).toBeInTheDocument();
  });
});
