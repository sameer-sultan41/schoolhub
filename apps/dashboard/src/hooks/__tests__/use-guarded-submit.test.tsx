import { zodResolver } from "@hookform/resolvers/zod";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useGuardedSubmit, useSubmitGuard } from "../use-submit-guard";

const schema = z.object({ name: z.string().min(1, "Name is required.") });
type Values = z.infer<typeof schema>;

/** Minimal stand-in for the four real call sites this hook replaces
 * (`GuardianFormBody.onSubmit`, `GuardianPickerBody`'s create-tab submit,
 * `AddEmergencyContactDialog`'s submit, `DocumentUploadDialog.handleFormSubmit`) — just
 * enough form to exercise `useGuardedSubmit` itself, not a real feature. */
function TestForm({ onValid }: { onValid: (values: Values) => Promise<void> }) {
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { name: "" } });
  const submitGuard = useSubmitGuard();
  const handleSubmit = useGuardedSubmit(form, submitGuard, onValid);
  const error = form.formState.errors.name?.message;

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="name">Name</label>
      <input id="name" {...form.register("name")} />
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit">Submit</button>
    </form>
  );
}

describe("useGuardedSubmit", () => {
  it("calls onValid with the form's values on a valid submit", async () => {
    const onValid = jest.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<TestForm onValid={onValid} />);

    await user.type(screen.getByLabelText("Name"), "Ayesha");
    await user.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => {
      expect(onValid).toHaveBeenCalledWith({ name: "Ayesha" });
    });
  });

  it("never calls onValid when the form's own validation fails", async () => {
    const onValid = jest.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<TestForm onValid={onValid} />);

    // Field left empty — fails the schema's min(1).
    await user.click(screen.getByRole("button", { name: /submit/i }));

    await screen.findByRole("alert");
    expect(onValid).not.toHaveBeenCalled();
  });

  it("blocks a second submit while the first onValid is still in flight, then allows a new one after it settles", async () => {
    let resolveFirst!: () => void;
    const onValid = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<TestForm onValid={onValid} />);

    await user.type(screen.getByLabelText("Name"), "Ayesha");
    const submitButton = screen.getByRole("button", { name: /submit/i });

    await user.click(submitButton);
    await waitFor(() => {
      expect(onValid).toHaveBeenCalledTimes(1);
    });

    // Dispatched while the first submit's returned promise is still pending — the guard
    // (not this test's mock) is what should suppress a second call here.
    await user.click(submitButton);
    expect(onValid).toHaveBeenCalledTimes(1);

    resolveFirst();
    await waitFor(() => {
      // Resolving `onValid` lets `useSubmitGuard` release; a further click now goes through.
      return user.click(submitButton);
    });
    await waitFor(() => {
      expect(onValid).toHaveBeenCalledTimes(2);
    });
  });

  it("releases the guard (without calling onValid again) when the wrapped submit throws unexpectedly", async () => {
    // Mirrors useSubmitGuard's own "releases on an unexpected rejection" test — every real
    // onValid already catches its own errors (see the hook's own doc comment), so this is
    // only the last-resort net.
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    const onValid = jest.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<TestForm onValid={onValid} />);

    await user.type(screen.getByLabelText("Name"), "Ayesha");
    const submitButton = screen.getByRole("button", { name: /submit/i });

    await user.click(submitButton);
    await waitFor(() => {
      expect(onValid).toHaveBeenCalledTimes(1);
    });

    await user.click(submitButton);
    await waitFor(() => {
      expect(onValid).toHaveBeenCalledTimes(2);
    });
    consoleError.mockRestore();
  });
});
