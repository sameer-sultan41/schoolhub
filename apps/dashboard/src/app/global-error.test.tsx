import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GlobalError from "./global-error";

describe("GlobalError", () => {
  it("renders its own html/body and logs the error", () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new Error("root boom"), { digest: "xyz" });

    render(<GlobalError error={error} reset={jest.fn()} />);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith("Unhandled error in the root layout:", error);
    consoleError.mockRestore();
  });

  it("calls reset when the button is clicked", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    const reset = jest.fn();
    const user = userEvent.setup();

    render(<GlobalError error={new Error("boom")} reset={reset} />);
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(reset).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });
});
