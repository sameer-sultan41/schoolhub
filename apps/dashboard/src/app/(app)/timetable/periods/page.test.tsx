import { render, screen } from "@testing-library/react";
import TimetablePeriodsPage from "./page";

jest.mock("@/features/timetable/periods-screen", () => ({
  PeriodsScreen: () => <div data-testid="periods-screen" />,
}));

jest.mock("next-intl/server", () => ({
  getTranslations: () =>
    Promise.resolve(
      (key: string) =>
        ({
          "periods.title": "Periods",
          "periods.summary":
            "The bell schedule every week grid is built on: teaching periods, breaks and their times.",
        })[key],
    ),
}));

describe("TimetablePeriodsPage", () => {
  it("renders the heading, summary, exactly one WovenRule, and no <main>", async () => {
    const ui = await TimetablePeriodsPage();
    const { container } = render(ui);

    expect(screen.getByRole("heading", { level: 1, name: "Periods" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "The bell schedule every week grid is built on: teaching periods, breaks and their times.",
      ),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("svg[viewBox='0 0 200 12']")).toHaveLength(1);
    expect(container.querySelector("main")).toBeNull();
    expect(screen.getByTestId("periods-screen")).toBeInTheDocument();
  });

  it("sets the page title via metadata", async () => {
    const { metadata } = await import("./page");
    expect(metadata.title).toBe("Periods");
  });
});
