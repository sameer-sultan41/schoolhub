import { render, screen } from "@testing-library/react";
import StaffPage from "./page";

jest.mock("@/features/staff/staff-table", () => ({
  StaffTable: () => <div data-testid="staff-table" />,
}));

// getTranslations (next-intl/server) has no working fix under the current
// next/jest setup — see students/page.test.tsx's identical mock for why.
jest.mock("next-intl/server", () => ({
  getTranslations: () =>
    Promise.resolve(
      (key: string) =>
        ({
          title: "Staff",
          summary: "Staff profiles, designations, qualifications, and documents.",
        })[key],
    ),
}));

describe("StaffPage", () => {
  it("renders the heading, summary, exactly one WovenRule, and no <main>", async () => {
    const ui = await StaffPage();
    const { container } = render(ui);

    expect(screen.getByRole("heading", { level: 1, name: "Staff" })).toBeInTheDocument();
    expect(
      screen.getByText("Staff profiles, designations, qualifications, and documents."),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("svg[viewBox='0 0 200 12']")).toHaveLength(1);
    expect(container.querySelector("main")).toBeNull();
    expect(screen.getByTestId("staff-table")).toBeInTheDocument();
  });

  it("sets the page title via metadata", async () => {
    const { metadata } = await import("./page");
    expect(metadata.title).toBe("Staff");
  });
});
