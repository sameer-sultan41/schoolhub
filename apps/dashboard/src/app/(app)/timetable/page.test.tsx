import { render, screen } from "@testing-library/react";
import TimetablePage from "./page";

jest.mock("@/features/timetable/week-grid-screen", () => ({
  WeekGridScreen: () => <div data-testid="week-grid-screen" />,
}));

jest.mock("next-intl/server", () => ({
  getTranslations: () =>
    Promise.resolve(
      (key: string) =>
        ({
          "grid.title": "Timetable",
          "grid.summary":
            "Build a section's week, period by period, and publish it once it is clear of conflicts.",
        })[key],
    ),
}));

describe("TimetablePage", () => {
  it("renders the heading, summary, exactly one WovenRule, and no <main>", async () => {
    const ui = await TimetablePage();
    const { container } = render(ui);

    expect(screen.getByRole("heading", { level: 1, name: "Timetable" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Build a section's week, period by period, and publish it once it is clear of conflicts.",
      ),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("svg[viewBox='0 0 200 12']")).toHaveLength(1);
    expect(container.querySelector("main")).toBeNull();
    expect(screen.getByTestId("week-grid-screen")).toBeInTheDocument();
  });

  it("sets the page title via metadata", async () => {
    const { metadata } = await import("./page");
    expect(metadata.title).toBe("Timetable");
  });
});
