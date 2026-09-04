import { render, screen } from "@testing-library/react";
import NewStaffPage from "./page";

jest.mock("@/features/staff/staff-form", () => ({
  StaffForm: ({ mode }: { mode: string }) => <div data-testid="staff-form" data-mode={mode} />,
}));

// getTranslations (next-intl/server) has no working fix under the current
// next/jest setup — see students/page.test.tsx's identical mock for why.
jest.mock("next-intl/server", () => ({
  getTranslations: () =>
    Promise.resolve(
      (key: string) =>
        ({
          "form.createTitle": "New staff member",
          summary: "Staff profiles, designations, qualifications, and documents.",
        })[key],
    ),
}));

describe("NewStaffPage", () => {
  it("renders the create-mode form under the create-title heading", async () => {
    const ui = await NewStaffPage();
    render(ui);

    expect(screen.getByRole("heading", { level: 1, name: "New staff member" })).toBeInTheDocument();
    const form = screen.getByTestId("staff-form");
    expect(form).toBeInTheDocument();
    expect(form).toHaveAttribute("data-mode", "create");
  });

  it("sets the page title via metadata", async () => {
    const { metadata } = await import("./page");
    expect(metadata.title).toBe("New staff member");
  });
});
