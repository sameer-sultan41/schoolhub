import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import Error from "./error";

describe("public-page Error boundary", () => {
  it("shows the error message and logs the error", () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new Error("boom"), { digest: "abc" });

    render(<Error error={error} reset={jest.fn()} />);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith(
      "Unhandled error while rendering a public page:",
      error,
    );
    consoleError.mockRestore();
  });

  it("calls reset when the retry button is clicked", () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    const reset = jest.fn();

    render(<Error error={new Error("boom")} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(reset).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });
});
