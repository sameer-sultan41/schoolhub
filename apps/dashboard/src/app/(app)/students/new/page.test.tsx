import { render, screen } from "@testing-library/react";
import NewStudentPage from "./page";

jest.mock("@/features/students/student-form", () => ({
  StudentForm: ({ mode }: { mode: string }) => <div data-testid="student-form" data-mode={mode} />,
}));

// getTranslations (next-intl/server) has no working fix under the current
// next/jest setup — see students/page.test.tsx's identical mock for why.
jest.mock("next-intl/server", () => ({
  getTranslations: () =>
    Promise.resolve(
      (key: string) =>
        ({
          "form.createTitle": "New student",
          summary: "Student profiles, guardians, and enrollment.",
        })[key],
    ),
}));

describe("NewStudentPage", () => {
  it("renders the create-mode form under the create-title heading", async () => {
    const ui = await NewStudentPage();
    render(ui);

    expect(screen.getByRole("heading", { level: 1, name: "New student" })).toBeInTheDocument();
    const form = screen.getByTestId("student-form");
    expect(form).toBeInTheDocument();
    expect(form).toHaveAttribute("data-mode", "create");
  });

  it("sets the page title via metadata", async () => {
    const { metadata } = await import("./page");
    expect(metadata.title).toBe("New student");
  });
});
