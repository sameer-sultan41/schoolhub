import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { Button } from "./button";

/**
 * Every standard Tailwind palette family, so a literal colour utility is caught
 * regardless of which family it happens to use — the previous version only listed
 * red/blue/green/indigo/slate, which let e.g. `bg-amber-500` or `bg-[#ff0000]` through.
 */
const LITERAL_COLOUR_UTILITY =
  /(?:bg|text|border)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(?:-\d{2,3})?\b|(?:bg|text|border)-\[#/;

describe("Button", () => {
  it("renders its label and fires onClick", async () => {
    const onClick = jest.fn();
    render(<Button onClick={onClick}>Create invoice</Button>);

    await userEvent.click(screen.getByRole("button", { name: "Create invoice" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("blocks interaction and announces state while loading", async () => {
    const onClick = jest.fn();
    render(
      <Button isLoading loadingLabel="Saving" onClick={onClick}>
        Save
      </Button>,
    );

    const button = screen.getByRole("button", { name: /Saving/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");

    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("defaults to type=button so it never submits a form by accident", () => {
    render(<Button>Cancel</Button>);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute("type", "button");
  });

  it("themes from tokens only — no literal colour classes", () => {
    render(<Button variant="danger">Delete</Button>);
    const className = screen.getByRole("button", { name: "Delete" }).className;

    expect(className).toContain("bg-danger");
    expect(className).not.toMatch(LITERAL_COLOUR_UTILITY);
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = render(<Button>Create invoice</Button>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
