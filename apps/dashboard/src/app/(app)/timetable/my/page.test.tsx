import { render, screen } from "@testing-library/react";
import MyTimetablePage from "./page";

jest.mock("@/features/timetable/my-timetable-screen", () => ({
  MyTimetableScreen: () => <div data-testid="my-timetable-screen" />,
}));

jest.mock("next-intl/server", () => ({
  getTranslations: () =>
    Promise.resolve(
      (key: string) =>
        ({
          "my.title": "My timetable",
          "my.summary": "Your own week, with any cover for the date you choose.",
        })[key],
    ),
}));

describe("MyTimetablePage", () => {
  it("renders the heading, summary, exactly one WovenRule, and no <main>", async () => {
    const ui = await MyTimetablePage();
    const { container } = render(ui);

    expect(screen.getByRole("heading", { level: 1, name: "My timetable" })).toBeInTheDocument();
    expect(
      screen.getByText("Your own week, with any cover for the date you choose."),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("svg[viewBox='0 0 200 12']")).toHaveLength(1);
    expect(container.querySelector("main")).toBeNull();
    expect(screen.getByTestId("my-timetable-screen")).toBeInTheDocument();
  });

  it("sets the page title via metadata", async () => {
    const { metadata } = await import("./page");
    expect(metadata.title).toBe("My timetable");
  });
});
