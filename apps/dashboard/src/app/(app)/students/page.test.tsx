import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";
import messages from "../../../../messages/en.json";
import StudentsPage from "./page";

jest.mock("@/features/students/students-table", () => ({
  StudentsTable: () => <div data-testid="students-table" />,
}));

describe("StudentsPage", () => {
  it("renders the heading, summary, exactly one WovenRule, and no <main>", async () => {
    const ui = await StudentsPage();
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {ui}
      </NextIntlClientProvider>,
    );

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
