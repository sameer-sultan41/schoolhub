import { render, screen } from "@testing-library/react";
import EditStaffPage from "./page";

jest.mock("@/features/staff/edit-staff-form", () => ({
  EditStaffForm: ({ staffId }: { staffId: string }) => (
    <div data-testid="edit-staff-form" data-staff-id={staffId} />
  ),
}));

// getTranslations (next-intl/server) has no working fix under the current
// next/jest setup — see students/page.test.tsx's identical mock for why.
jest.mock("next-intl/server", () => ({
  getTranslations: () =>
    Promise.resolve(
      (key: string) =>
        ({
          "form.editTitle": "Edit staff member",
          summary: "Staff profiles, designations, qualifications, and documents.",
        })[key],
    ),
}));

describe("EditStaffPage", () => {
  it("resolves the staffId param and passes it to the edit form", async () => {
    const ui = await EditStaffPage({ params: Promise.resolve({ staffId: "st-1" }) });
    render(ui);

    expect(
      screen.getByRole("heading", { level: 1, name: "Edit staff member" }),
    ).toBeInTheDocument();
    const form = screen.getByTestId("edit-staff-form");
    expect(form).toBeInTheDocument();
    expect(form).toHaveAttribute("data-staff-id", "st-1");
  });

  it("sets the page title via metadata", async () => {
    const { metadata } = await import("./page");
    expect(metadata.title).toBe("Edit staff member");
  });
});
