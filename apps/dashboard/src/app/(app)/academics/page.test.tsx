import { render, screen } from "@testing-library/react";
import AcademicsPage from "./page";

jest.mock("@/features/academics/curriculum-screen", () => ({
  CurriculumScreen: () => <div data-testid="curriculum-screen" />,
}));

// getTranslations (next-intl/server) has no working fix under the current
// next/jest setup — see staff/page.test.tsx's identical mock for why.
jest.mock("next-intl/server", () => ({
  getTranslations: () =>
    Promise.resolve(
      (key: string) =>
        ({
          "curriculum.title": "Curriculum",
          "curriculum.summary": "Class-by-subject mappings for a session.",
        })[key],
    ),
}));

describe("AcademicsPage", () => {
  it("renders the heading, summary, exactly one WovenRule, and no <main>", async () => {
    const ui = await AcademicsPage();
    const { container } = render(ui);

    expect(screen.getByRole("heading", { level: 1, name: "Curriculum" })).toBeInTheDocument();
    expect(screen.getByText("Class-by-subject mappings for a session.")).toBeInTheDocument();
    expect(container.querySelectorAll("svg[viewBox='0 0 200 12']")).toHaveLength(1);
    expect(container.querySelector("main")).toBeNull();
    expect(screen.getByTestId("curriculum-screen")).toBeInTheDocument();
  });

  it("sets the page title via metadata", async () => {
    const { metadata } = await import("./page");
    expect(metadata.title).toBe("Curriculum");
  });
});
