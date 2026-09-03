import { render, screen } from "@testing-library/react";
import EditStudentPage from "./page";

jest.mock("@/features/students/edit-student-form", () => ({
  EditStudentForm: ({ studentId }: { studentId: string }) => (
    <div data-testid="edit-student-form" data-student-id={studentId} />
  ),
}));

// getTranslations (next-intl/server) has no working fix under the current
// next/jest setup — see students/page.test.tsx's identical mock for why.
jest.mock("next-intl/server", () => ({
  getTranslations: () =>
    Promise.resolve(
      (key: string) =>
        ({
          "form.editTitle": "Edit student",
          summary: "Student profiles, guardians, and enrollment.",
        })[key],
    ),
}));

describe("EditStudentPage", () => {
  it("resolves the studentId param and passes it to the edit form", async () => {
    const ui = await EditStudentPage({ params: Promise.resolve({ studentId: "s-1" }) });
    render(ui);

    expect(screen.getByRole("heading", { level: 1, name: "Edit student" })).toBeInTheDocument();
    const form = screen.getByTestId("edit-student-form");
    expect(form).toBeInTheDocument();
    expect(form).toHaveAttribute("data-student-id", "s-1");
  });

  it("sets the page title via metadata", async () => {
    const { metadata } = await import("./page");
    expect(metadata.title).toBe("Edit student");
  });
});
