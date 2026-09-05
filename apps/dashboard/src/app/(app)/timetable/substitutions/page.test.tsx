import { render, screen } from "@testing-library/react";
import TimetableSubstitutionsPage from "./page";

jest.mock("@/features/timetable/substitutions-screen", () => ({
  SubstitutionsScreen: () => <div data-testid="substitutions-screen" />,
}));

jest.mock("next-intl/server", () => ({
  getTranslations: () =>
    Promise.resolve(
      (key: string) =>
        ({
          "substitutions.title": "Substitutions",
          "substitutions.summary":
            "Cover for an absent teacher on a given date, without touching the published timetable.",
        })[key],
    ),
}));

describe("TimetableSubstitutionsPage", () => {
  it("renders the heading, summary, exactly one WovenRule, and no <main>", async () => {
    const ui = await TimetableSubstitutionsPage();
    const { container } = render(ui);

    expect(screen.getByRole("heading", { level: 1, name: "Substitutions" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Cover for an absent teacher on a given date, without touching the published timetable.",
      ),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("svg[viewBox='0 0 200 12']")).toHaveLength(1);
    expect(container.querySelector("main")).toBeNull();
    expect(screen.getByTestId("substitutions-screen")).toBeInTheDocument();
  });

  it("sets the page title via metadata", async () => {
    const { metadata } = await import("./page");
    expect(metadata.title).toBe("Substitutions");
  });
});
