import { ApiError } from "@schoolhub/api-client";
import { Button, Input } from "@schoolhub/ui";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";

import { renderWithProviders } from "@/test-utils";

import { useFormDialogSubmit } from "../use-form-dialog-submit";

interface Values {
  name: string;
  note: string;
}

const FALLBACK = "Fallback message";

const noop = () => undefined;

interface HarnessProps {
  mutationFn: (values: Values) => Promise<string>;
  knownFields?: readonly string[] | (() => readonly string[]);
  onSuccess?: (result: string, values: Values) => void;
}

/** A form wired to the hook the way a dialog is: errors under the inputs, the rest above. */
function Harness({ mutationFn, knownFields = ["name", "note"], onSuccess = noop }: HarnessProps) {
  const form = useForm<Values>({ defaultValues: { name: "Ayesha", note: "" } });
  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn,
    knownFields,
    onSuccess,
    fallbackMessage: FALLBACK,
  });
  const { errors } = form.formState;

  return (
    <form aria-label="Test form" onSubmit={handleSubmit} noValidate>
      <Input aria-label="Name" {...form.register("name", { required: "Name is required" })} />
      {errors.name && <p>{errors.name.message}</p>}
      <Input aria-label="Note" {...form.register("note")} />
      {errors.note && <p>{errors.note.message}</p>}
      {formError && <p role="alert">{formError}</p>}
      <Button type="submit">Submit</Button>
      <span>{isPending ? "pending" : "idle"}</span>
    </form>
  );
}

function refusal(field: string, issue: string) {
  return new ApiError({
    code: "domain_rule_violation",
    message: issue,
    status: 422,
    url: "/things",
    details: [{ field, issue }],
  });
}

/** A promise the test settles by hand, to observe the form while a request is in flight. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function submit() {
  return userEvent.setup().click(screen.getByRole("button", { name: "Submit" }));
}

describe("useFormDialogSubmit", () => {
  it("sends the form's values, then reports the result and the values it sent", async () => {
    const mutationFn = jest.fn().mockResolvedValue("saved");
    const onSuccess = jest.fn();
    renderWithProviders(<Harness mutationFn={mutationFn} onSuccess={onSuccess} />);

    await submit();

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith("saved", { name: "Ayesha", note: "" });
    });
    expect(mutationFn).toHaveBeenCalledTimes(1);
    expect(mutationFn.mock.calls[0]?.[0]).toEqual({ name: "Ayesha", note: "" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sends nothing while the form is invalid", async () => {
    const mutationFn = jest.fn().mockResolvedValue("saved");
    renderWithProviders(<Harness mutationFn={mutationFn} />);

    await userEvent.setup().clear(screen.getByRole("textbox", { name: "Name" }));
    await submit();

    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(mutationFn).not.toHaveBeenCalled();
  });

  it("reports pending while the request is in flight", async () => {
    const request = deferred<string>();
    renderWithProviders(<Harness mutationFn={() => request.promise} />);

    await submit();

    expect(await screen.findByText("pending")).toBeInTheDocument();
    await act(async () => {
      request.resolve("saved");
      await request.promise;
    });
    expect(await screen.findByText("idle")).toBeInTheDocument();
  });

  it("keeps a server error on a known field under that field, and does not succeed", async () => {
    const issue = "That name is taken.";
    const onSuccess = jest.fn();
    renderWithProviders(
      <Harness mutationFn={() => Promise.reject(refusal("name", issue))} onSuccess={onSuccess} />,
    );

    await submit();

    expect(await screen.findByText(issue)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("folds an error on a field with no input into the form's own message", async () => {
    const issue = "The session is closed.";
    renderWithProviders(
      <Harness
        mutationFn={() => Promise.reject(refusal("academic_session_id", issue))}
        knownFields={["name"]}
      />,
    );

    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(issue);
    expect(screen.queryByText("That action isn't allowed right now.")).not.toBeInTheDocument();
  });

  it("shows a refusal that names no field as the form's own message", async () => {
    const issue = "Something about the whole form.";
    renderWithProviders(<Harness mutationFn={() => Promise.reject(refusal("non_field", issue))} />);

    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(issue);
  });

  it("reads the known fields when the error arrives, not when the form rendered", async () => {
    const request = deferred<string>();
    let noteHasInput = false;
    renderWithProviders(
      <Harness
        mutationFn={() => request.promise}
        knownFields={() => (noteHasInput ? ["name", "note"] : ["name"])}
      />,
    );

    await submit();
    noteHasInput = true;
    await act(async () => {
      request.reject(refusal("note", "The note is too long."));
      await request.promise.catch(() => undefined);
    });

    expect(await screen.findByText("The note is too long.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("falls back to its own message for a failure that isn't an API error", async () => {
    renderWithProviders(<Harness mutationFn={() => Promise.reject(new TypeError("down"))} />);

    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(FALLBACK);
  });

  it("clears the form's message as soon as the next attempt starts", async () => {
    const issue = "Something about the whole form.";
    const second = deferred<string>();
    const mutationFn = jest
      .fn<Promise<string>, [Values]>()
      .mockRejectedValueOnce(refusal("non_field", issue))
      .mockReturnValueOnce(second.promise);
    const onSuccess = jest.fn();
    renderWithProviders(<Harness mutationFn={mutationFn} onSuccess={onSuccess} />);

    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(issue);
    await submit();

    // The second request is still in flight, and the old message is already gone.
    expect(await screen.findByText("pending")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
    await act(async () => {
      second.resolve("saved");
      await second.promise;
    });
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });

  it("sends one request for a double submit, and accepts the next once it settles", async () => {
    const first = deferred<string>();
    const mutationFn = jest
      .fn<Promise<string>, [Values]>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue("saved");
    renderWithProviders(<Harness mutationFn={mutationFn} />);
    const form = screen.getByRole("form", { name: "Test form" });

    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mutationFn).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      first.resolve("saved");
      await first.promise;
    });
    await waitFor(() => {
      expect(screen.getByText("idle")).toBeInTheDocument();
    });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mutationFn).toHaveBeenCalledTimes(2);
    });
  });
});
