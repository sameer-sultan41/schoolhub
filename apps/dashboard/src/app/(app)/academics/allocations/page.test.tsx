import { render, screen } from "@testing-library/react";
import AcademicsAllocationsPage from "./page";

jest.mock("@/features/academics/allocations-screen", () => ({
  AllocationsScreen: () => <div data-testid="allocations-screen" />,
}));

jest.mock("next-intl/server", () => ({
  getTranslations: () =>
    Promise.resolve(
      (key: string) =>
        ({
          "allocations.title": "Teacher allocation",
          "allocations.summary": "Who teaches what, to whom, and how heavy the load is.",
        })[key],
    ),
}));

describe("AcademicsAllocationsPage", () => {
  it("renders the heading, summary, exactly one WovenRule, and no <main>", async () => {
    const ui = await AcademicsAllocationsPage();
    const { container } = render(ui);

    expect(
      screen.getByRole("heading", { level: 1, name: "Teacher allocation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Who teaches what, to whom, and how heavy the load is."),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("svg[viewBox='0 0 200 12']")).toHaveLength(1);
    expect(container.querySelector("main")).toBeNull();
    expect(screen.getByTestId("allocations-screen")).toBeInTheDocument();
  });

  it("sets the page title via metadata", async () => {
    const { metadata } = await import("./page");
    expect(metadata.title).toBe("Teacher allocation");
  });
});
