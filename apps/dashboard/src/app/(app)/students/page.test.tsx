import { render, screen } from "@testing-library/react";
import StudentsPage from "./page";

jest.mock("@/features/students/students-table", () => ({
  StudentsTable: () => <div data-testid="students-table" />,
}));

// getTranslations (next-intl/server) has no working fix under the current
// next/jest setup — it resolves a client-guarded build under Jest regardless
// of environment, since next/jest sets no react-server export condition. Mock
// it directly rather than fighting that; the strings mirror messages/en.json's
// `students.title`/`students.summary` verbatim.
jest.mock("next-intl/server", () => ({
  getTranslations: () =>
    Promise.resolve(
      (key: string) =>
        ({
          title: "Students",
          summary: "Student profiles, guardians, and enrollment.",
        })[key],
    ),
}));

describe("StudentsPage", () => {
  it("renders the heading, summary, exactly one WovenRule, and no <main>", async () => {
    const ui = await StudentsPage();
    const { container } = render(ui);

    expect(screen.getByRole("heading", { level: 1, name: "Students" })).toBeInTheDocument();
    expect(screen.getByText("Student profiles, guardians, and enrollment.")).toBeInTheDocument();
    expect(container.querySelectorAll("svg[viewBox='0 0 200 12']")).toHaveLength(1);
    expect(container.querySelector("main")).toBeNull();
    expect(screen.getByTestId("students-table")).toBeInTheDocument();
  });

  it("sets the page title via metadata", async () => {
    const { metadata } = await import("./page");
    expect(metadata.title).toBe("Students");
  });
});
