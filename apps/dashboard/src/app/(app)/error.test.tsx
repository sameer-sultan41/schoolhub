import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test-utils";
import Error from "./error";

describe("(app) Error boundary", () => {
  it("shows the page-error message and logs the error", () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new Error("boom"), { digest: "abc123" });

    renderWithProviders(<Error error={error} reset={jest.fn()} />);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith("Unhandled error in the (app) segment:", error);
    consoleError.mockRestore();
  });

  it("calls reset when the retry button is clicked", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    const reset = jest.fn();
    const user = userEvent.setup();

    renderWithProviders(<Error error={new Error("boom")} reset={reset} />);
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(reset).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });
});
