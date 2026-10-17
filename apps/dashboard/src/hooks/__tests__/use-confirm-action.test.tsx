import { ApiError } from "@schoolhub/api-client";
import { Button } from "@schoolhub/ui";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "@/test-utils";

import { useConfirmAction } from "../use-confirm-action";

const FALLBACK = "Fallback message";

const noop = () => undefined;

interface HarnessProps {
  mutationFn: () => Promise<string>;
  onSuccess?: (result: string) => void;
}

function Harness({ mutationFn, onSuccess = noop }: HarnessProps) {
  const { error, isPending, confirm } = useConfirmAction({
    mutationFn,
    onSuccess,
    fallbackMessage: FALLBACK,
  });

  return (
    <div>
      <Button onClick={confirm}>Confirm</Button>
      {error && <p role="alert">{error}</p>}
      <span>{isPending ? "pending" : "idle"}</span>
    </div>
  );
}

function refusal(field: string, issue: string) {
  return new ApiError({
    code: "domain_rule_violation",
    message: issue,
    status: 422,
    url: "/things/1",
    details: [{ field, issue }],
  });
}

/** A promise the test settles by hand, to observe the dialog while a request is in flight. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function confirmNow() {
  return userEvent.setup().click(screen.getByRole("button", { name: "Confirm" }));
}

describe("useConfirmAction", () => {
  it("runs the action once and reports its result", async () => {
    const mutationFn = jest.fn().mockResolvedValue("removed");
    const onSuccess = jest.fn();
    renderWithProviders(<Harness mutationFn={mutationFn} onSuccess={onSuccess} />);

    await confirmNow();

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith("removed");
    });
    expect(mutationFn).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports pending while the action is in flight", async () => {
    const request = deferred<string>();
    renderWithProviders(<Harness mutationFn={() => request.promise} />);

    await confirmNow();

    expect(await screen.findByText("pending")).toBeInTheDocument();
    await act(async () => {
      request.resolve("removed");
      await request.promise;
    });
    expect(await screen.findByText("idle")).toBeInTheDocument();
  });

  it("shows a refusal that names no field as the message, and does not succeed", async () => {
    const issue = "The session is closed.";
    const onSuccess = jest.fn();
    renderWithProviders(
      <Harness
        mutationFn={() => Promise.reject(refusal("non_field", issue))}
        onSuccess={onSuccess}
      />,
    );

    await confirmNow();

    expect(await screen.findByRole("alert")).toHaveTextContent(issue);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("folds a refusal that names a field into the message, as there are no inputs", async () => {
    const issue = "Removing this leaves the group with no options.";
    renderWithProviders(
      <Harness mutationFn={() => Promise.reject(refusal("elective_group", issue))} />,
    );

    await confirmNow();

    expect(await screen.findByRole("alert")).toHaveTextContent(issue);
    expect(screen.queryByText("That action isn't allowed right now.")).not.toBeInTheDocument();
  });

  it("falls back to its own message for a failure that isn't an API error", async () => {
    renderWithProviders(<Harness mutationFn={() => Promise.reject(new TypeError("down"))} />);

    await confirmNow();

    expect(await screen.findByRole("alert")).toHaveTextContent(FALLBACK);
  });

  it("clears the message as soon as it is tried again", async () => {
    const second = deferred<string>();
    const mutationFn = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(refusal("non_field", "The session is closed."))
      .mockReturnValueOnce(second.promise);
    renderWithProviders(<Harness mutationFn={mutationFn} />);

    await confirmNow();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await confirmNow();

    // The second attempt is still in flight, and the old message is already gone.
    expect(await screen.findByText("pending")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => {
      second.resolve("removed");
      await second.promise;
    });
    expect(await screen.findByText("idle")).toBeInTheDocument();
  });
});
