import { render, screen } from "@testing-library/react";
import TimetableRoomsPage from "./page";

jest.mock("@/features/timetable/rooms-screen", () => ({
  RoomsScreen: () => <div data-testid="rooms-screen" />,
}));

jest.mock("next-intl/server", () => ({
  getTranslations: () =>
    Promise.resolve(
      (key: string) =>
        ({
          "rooms.title": "Rooms",
          "rooms.summary":
            "Rooms, their type and their capacity — what the conflict check reads when a section will not fit.",
        })[key],
    ),
}));

describe("TimetableRoomsPage", () => {
  it("renders the heading, summary, exactly one WovenRule, and no <main>", async () => {
    const ui = await TimetableRoomsPage();
    const { container } = render(ui);

    expect(screen.getByRole("heading", { level: 1, name: "Rooms" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Rooms, their type and their capacity — what the conflict check reads when a section will not fit.",
      ),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("svg[viewBox='0 0 200 12']")).toHaveLength(1);
    expect(container.querySelector("main")).toBeNull();
    expect(screen.getByTestId("rooms-screen")).toBeInTheDocument();
  });

  it("sets the page title via metadata", async () => {
    const { metadata } = await import("./page");
    expect(metadata.title).toBe("Rooms");
  });
});
