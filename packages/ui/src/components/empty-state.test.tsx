import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Users } from "lucide-react";
import { Button } from "./button";
import { EmptyState } from "./empty-state";

const base = {
  icon: Users,
  title: "No students yet",
  description: "Add your first student, or import a class list.",
} as const;

describe("EmptyState", () => {
  it("says what is missing and what to do about it", () => {
    render(<EmptyState {...base} />);

    expect(screen.getByText("No students yet")).toBeInTheDocument();
    expect(screen.getByText("Add your first student, or import a class list.")).toBeInTheDocument();
  });

  it("renders the action when one is given", () => {
    render(<EmptyState {...base} action={<Button>Add student</Button>} />);
    expect(screen.getByRole("button", { name: "Add student" })).toBeInTheDocument();
  });

  it("renders nothing where the action would be when the viewer holds no permission", () => {
    // Callers gate the action with <Can>, which renders null — the empty state must still
    // read as a complete sentence without it, not as a form missing its button.
    render(<EmptyState {...base} action={null} />);

    expect(screen.getByText("No students yet")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps the icon out of the accessible name", () => {
    const { container } = render(<EmptyState {...base} />);
    expect(container.querySelector("span[aria-hidden]")).toHaveAttribute("aria-hidden", "true");
  });

  it("never announces itself as an error", () => {
    // "Not built yet" is not a failure, and the info tone must not acquire alert
    // semantics — that was the bug on the old dashboard home.
    render(<EmptyState {...base} tone="info" title="Attendance is not built yet" />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = render(<EmptyState {...base} action={<Button>Add student</Button>} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
