import { render, screen } from "@testing-library/react";
import { QueryErrorMessage } from "../query-error-message";

describe("QueryErrorMessage", () => {
  it("shows a real Error's own message", () => {
    render(<QueryErrorMessage error={new Error("overview unreachable")} />);

    expect(screen.getByText("overview unreachable")).toBeInTheDocument();
  });

  it("falls back to a generic message for a non-Error thrown value", () => {
    render(<QueryErrorMessage error="not an Error instance" />);

    expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
  });
});
