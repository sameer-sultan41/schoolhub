import { render, screen } from "@testing-library/react";
import ImportStudentsPage from "./page";

jest.mock("@/features/students/import-wizard", () => ({
  ImportWizard: () => <div data-testid="import-wizard" />,
}));

// getTranslations (next-intl/server) has no working fix under the current
// next/jest setup — see students/page.test.tsx's identical mock for why.
jest.mock("next-intl/server", () => ({
  getTranslations: () =>
    Promise.resolve(
      (key: string) =>
        ({
          "import.title": "Import students",
          "import.description": "Bulk-create students from a CSV or .xlsx file.",
        })[key],
    ),
}));

describe("ImportStudentsPage", () => {
  it("renders the heading, description, exactly one WovenRule, and the wizard", async () => {
    const ui = await ImportStudentsPage();
    const { container } = render(ui);

    expect(screen.getByRole("heading", { level: 1, name: "Import students" })).toBeInTheDocument();
    expect(screen.getByText("Bulk-create students from a CSV or .xlsx file.")).toBeInTheDocument();
    expect(container.querySelectorAll("svg[viewBox='0 0 200 12']")).toHaveLength(1);
    expect(screen.getByTestId("import-wizard")).toBeInTheDocument();
  });

  it("sets the page title via metadata", async () => {
    const { metadata } = await import("./page");
    expect(metadata.title).toBe("Import students");
  });
});
