import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { Checkbox } from "./checkbox";

describe("Checkbox", () => {
  it("takes its accessible name from the required label prop", () => {
    render(<Checkbox label="Select this student" />);

    expect(screen.getByRole("checkbox", { name: "Select this student" })).toBeInTheDocument();
  });

  it("toggles on click", async () => {
    const onCheckedChange = jest.fn();
    render(<Checkbox label="Select this student" onCheckedChange={onCheckedChange} />);

    const checkbox = screen.getByRole("checkbox", { name: "Select this student" });
    expect(checkbox).not.toBeChecked();

    await userEvent.click(checkbox);

    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(checkbox).toBeChecked();
  });

  it("reports aria-checked=mixed when indeterminate", () => {
    render(<Checkbox label="Select all students on this page" checked="indeterminate" />);

    const checkbox = screen.getByRole("checkbox", { name: "Select all students on this page" });
    // "mixed" is the whole point of the state: it is what a screen reader announces for
    // some-but-not-all, and neither `true` nor `false` says that.
    expect(checkbox).toHaveAttribute("aria-checked", "mixed");
    // The Minus-instead-of-Check swap is CSS keyed off this attribute (see checkbox.tsx),
    // and jsdom applies no stylesheet — so assert the state the icons are selected by,
    // not which <svg> happens to sit in the DOM.
    expect(checkbox).toHaveAttribute("data-state", "indeterminate");
  });

  it("is operable from the keyboard", async () => {
    const onCheckedChange = jest.fn();
    render(<Checkbox label="Select this student" onCheckedChange={onCheckedChange} />);

    await userEvent.tab();
    const checkbox = screen.getByRole("checkbox", { name: "Select this student" });
    expect(checkbox).toHaveFocus();

    await userEvent.keyboard("[Space]");

    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(checkbox).toBeChecked();
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = render(<Checkbox label="Select this student" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
