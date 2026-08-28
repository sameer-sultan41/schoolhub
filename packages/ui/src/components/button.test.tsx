import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./button";

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
    expect(className).not.toMatch(/(bg|text)-(red|blue|green|indigo|slate)-\d{2,3}/);
  });
});
