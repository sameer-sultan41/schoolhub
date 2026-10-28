import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { z } from "zod";

import { DecisionDialog, type DecisionDialogCopy } from "@/features/attendance/decision-dialog";
import { renderWithClient } from "@/test-utils";

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{ servicesMock: (domains: Record<string, readonly string[]>) => unknown }>(
      "@/test-fixtures/services-mock",
    )
    .servicesMock({}),
);

const COPY: DecisionDialogCopy = {
  title: "Approve thing",
  description: "Approve the thing for Amna Raza.",
  submit: "Approve",
  submitting: "Approving…",
  note: "Comment (optional)",
  noteHint: "The requester can read this.",
  noteTooLong: "Keep it short.",
};

const QUEUE = "things";
const RECORDS = "thing-records";
const ALREADY_DECIDED = "This thing was already approved.";
const GENERIC_CONFLICT = /conflicts with the current data/;

/** A module schema keyed by its own field name, as the real ones are. */
function createCommentSchema(messages: { noteTooLong: string }) {
  return z.object({ comment: z.string().max(10, messages.noteTooLong) });
}

function refusal(status: number, code: string, message: string, field?: string) {
  return new ApiError({
    code,
    message,
    status,
    url: "/things/1:approve",
    details: field ? [{ field, issue: message }] : [],
  });
}

function renderDialog(decide: jest.Mock, alsoRefresh?: readonly string[]) {
  const onOpenChange = jest.fn();
  const user = userEvent.setup();
  const { queryClient } = renderWithClient(
    <DecisionDialog
      open
      onOpenChange={onOpenChange}
      copy={COPY}
      createSchema={createCommentSchema}
      noteField="comment"
      noteMaxLength={500}
      knownFields={["comment"]}
      decide={decide}
      queueModule={QUEUE}
      alsoRefresh={alsoRefresh}
      successMessage={(result: { marked: number }) => `Marked ${String(result.marked)} days.`}
    />,
  );
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");
  return { user, onOpenChange, invalidate };
}

/** The query modules the spy was asked to invalidate, in call order. */
function invalidated(invalidate: jest.SpyInstance) {
  return invalidate.mock.calls.map(([filters]) => (filters as { queryKey: string[] }).queryKey[0]);
}

const submit = () => screen.getByRole("button", { name: COPY.submit });
const noteInput = () => screen.getByLabelText(COPY.note);

describe("DecisionDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("sends the note, toasts what the decision did, reloads and closes", async () => {
    const decide = jest.fn().mockResolvedValue({ marked: 3 });
    const { user, onOpenChange, invalidate } = renderDialog(decide, [RECORDS]);

    expect(screen.getByRole("dialog", { name: COPY.title })).toBeInTheDocument();
    expect(screen.getByText(COPY.description)).toBeInTheDocument();
    await user.type(noteInput(), "Seen it");
    await user.click(submit());

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(decide).toHaveBeenCalledWith("Seen it");
    expect(toast.success).toHaveBeenCalledWith("Marked 3 days.");
    expect(invalidated(invalidate)).toEqual([QUEUE, RECORDS]);
  });

  it("sends an empty note when none is written and reloads only the queue", async () => {
    const decide = jest.fn().mockResolvedValue({ marked: 0 });
    const { user, onOpenChange, invalidate } = renderDialog(decide);

    await user.click(submit());

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(decide).toHaveBeenCalledWith("");
    expect(invalidated(invalidate)).toEqual([QUEUE]);
  });

  it("checks the note against the module's schema before sending", async () => {
    const decide = jest.fn();
    const { user } = renderDialog(decide);

    await user.type(noteInput(), "Far too long a note");
    await user.click(submit());

    expect(await screen.findByText(COPY.noteTooLong)).toBeInTheDocument();
    expect(decide).not.toHaveBeenCalled();
  });

  it("shows a server error on the note under its input", async () => {
    const decide = jest
      .fn()
      .mockRejectedValue(refusal(422, "validation_error", "Say why.", "comment"));
    const { user, onOpenChange } = renderDialog(decide);

    await user.click(submit());

    expect(await screen.findByText("Say why.")).toBeInTheDocument();
    expect(noteInput()).toHaveAttribute("aria-invalid", "true");
    expect(submit()).toBeEnabled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("keeps any other refusal inline, the dialog open and the decision available", async () => {
    const decide = jest
      .fn()
      .mockRejectedValue(refusal(422, "domain_rule_violation", "Not your own.", "reviewed_by"));
    const { user, onOpenChange, invalidate } = renderDialog(decide);

    await user.click(submit());

    expect(await screen.findByText("Not your own.")).toBeInTheDocument();
    expect(submit()).toBeEnabled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("on a 409 keeps the server's sentence, reloads the queue and holds the submit", async () => {
    const decide = jest.fn().mockRejectedValue(refusal(409, "conflict", ALREADY_DECIDED));
    const { user, onOpenChange, invalidate } = renderDialog(decide, [RECORDS]);

    await user.click(submit());

    expect(await screen.findByText(ALREADY_DECIDED)).toBeInTheDocument();
    expect(screen.queryByText(GENERIC_CONFLICT)).not.toBeInTheDocument();
    expect(submit()).toBeDisabled();
    // Only the queue: nothing was decided, so the records are unchanged.
    expect(invalidated(invalidate)).toEqual([QUEUE]);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("falls back to the generic message for a failure that is not an API error", async () => {
    const decide = jest.fn().mockRejectedValue(new Error("network down"));
    const { user } = renderDialog(decide);

    await user.click(submit());

    expect(await screen.findByText("Something went wrong. Please try again.")).toBeInTheDocument();
    expect(submit()).toBeEnabled();
  });
});
