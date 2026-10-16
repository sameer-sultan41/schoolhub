import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { queryKeys } from "@/lib/query-client";
import { Services, type PromotionTransition } from "@/services";
import {
  BATCH_ID,
  deferred,
  refusal,
  unprocessable,
} from "@/services/modules/promotions/__tests__/promotions-fixtures";
import {
  PROMOTION_BATCH_RESOURCE,
  PROMOTION_BATCHES_RESOURCE,
  PROMOTION_QUERY_MODULE,
} from "@/services/modules/promotions/promotions-constant";
import { renderWithClient } from "@/test-utils";

import { PromotionTransitionDialog } from "../promotion-transition-dialog";

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: { promotions: { transitionBatch: jest.fn() } },
}));

const mockTransition = Services.promotions.transitionBatch as jest.MockedFunction<
  typeof Services.promotions.transitionBatch
>;

const DETAIL_KEY = queryKeys.detail(PROMOTION_QUERY_MODULE, PROMOTION_BATCH_RESOURCE, BATCH_ID);
const LIST_KEY = queryKeys.list(PROMOTION_QUERY_MODULE, PROMOTION_BATCHES_RESOURCE);
const BARE_KEY = queryKeys.module(PROMOTION_QUERY_MODULE);

const SUBMIT_TITLE = "Submit this batch for approval?";
const APPROVE_TITLE = "Approve this batch?";
const REJECT_TITLE = "Reject this batch?";
const REVERT_TITLE = "Revert this batch?";
const EXECUTE_TITLE = "Execute this batch?";

/**
 * Each transition's dialog title and confirm label, and a phrase of its description. The confirm
 * reads as the button that opened the dialog, so the two never confuse a screen reader or a
 * locator, and the page's own button is hidden behind the dialog while it is open.
 */
const TRANSITIONS: [PromotionTransition, string, string, string][] = [
  ["submit", SUBMIT_TITLE, "Submit for approval", "Someone other than you must approve"],
  ["approve", APPROVE_TITLE, "Approve", "You can't approve a batch you prepared"],
  ["reject", REJECT_TITLE, "Reject", "The batch goes back to draft"],
  ["revert", REVERT_TITLE, "Revert", "The batch is closed"],
];

function renderTransition(action: PromotionTransition) {
  const onOpenChange = jest.fn();
  const view = renderWithClient(
    <PromotionTransitionDialog
      open
      onOpenChange={onOpenChange}
      batchId={BATCH_ID}
      action={action}
    />,
  );
  const invalidate = jest.spyOn(view.queryClient, "invalidateQueries");
  return { ...view, invalidate, onOpenChange, user: userEvent.setup() };
}

function renderExecute(onExecute: () => Promise<void>) {
  const onOpenChange = jest.fn();
  const view = renderWithClient(
    <PromotionTransitionDialog
      open
      onOpenChange={onOpenChange}
      batchId={BATCH_ID}
      action="execute"
      onExecute={onExecute}
    />,
  );
  const invalidate = jest.spyOn(view.queryClient, "invalidateQueries");
  return { ...view, invalidate, onOpenChange, user: userEvent.setup() };
}

function dialogOf(title: string) {
  return screen.getByRole("alertdialog", { name: title });
}

function buttonIn(title: string, label: string) {
  return within(dialogOf(title)).getByRole("button", { name: label });
}

describe("PromotionTransitionDialog", () => {
  beforeEach(() => {
    mockTransition.mockReset().mockResolvedValue({ updated: 24 });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("what it asks", () => {
    it.each(TRANSITIONS)("%s: titled for the step", (action, title, label, phrase) => {
      renderTransition(action);

      expect(dialogOf(title)).toHaveTextContent(phrase);
      expect(buttonIn(title, label)).toBeInTheDocument();
      expect(buttonIn(title, "Cancel")).toBeInTheDocument();
    });

    it("titles the execute dialog for the run, and confirms it as Execute", () => {
      renderExecute(jest.fn());

      expect(dialogOf(EXECUTE_TITLE)).toHaveTextContent("This runs in the background");
      expect(buttonIn(EXECUTE_TITLE, "Execute")).toBeInTheDocument();
    });

    it("makes the confirm of a reject destructive", () => {
      renderTransition("reject");

      expect(buttonIn(REJECT_TITLE, "Reject")).toHaveClass("bg-destructive");
    });

    it("makes the confirm of a revert destructive", () => {
      renderTransition("revert");

      expect(buttonIn(REVERT_TITLE, "Revert")).toHaveClass("bg-destructive");
    });

    it("leaves the confirm of the forward steps in the primary colour", () => {
      renderTransition("approve");

      expect(buttonIn(APPROVE_TITLE, "Approve")).not.toHaveClass("bg-destructive");
    });
  });

  describe("confirming a transition", () => {
    it.each(TRANSITIONS)("%s: sends it and refreshes", async (action, title, label) => {
      const { user, onOpenChange, invalidate } = renderTransition(action);

      await user.click(buttonIn(title, label));

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
      expect(mockTransition).toHaveBeenCalledTimes(1);
      expect(mockTransition).toHaveBeenCalledWith(BATCH_ID, action, expect.any(String));
      expect(invalidate).toHaveBeenCalledTimes(2);
      expect(invalidate).toHaveBeenCalledWith({ queryKey: DETAIL_KEY });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: LIST_KEY });
      // The bare module key would also refetch a running execute poll.
      expect(invalidate).not.toHaveBeenCalledWith({ queryKey: BARE_KEY });
    });

    it("disables both buttons while in flight, so a second click sends nothing", async () => {
      const request = deferred<{ updated: number }>();
      mockTransition.mockReturnValue(request.promise);
      const { user, onOpenChange } = renderTransition("approve");

      await user.click(buttonIn(APPROVE_TITLE, "Approve"));

      await waitFor(() => {
        expect(buttonIn(APPROVE_TITLE, "Approve")).toBeDisabled();
      });
      expect(buttonIn(APPROVE_TITLE, "Cancel")).toBeDisabled();
      await user.click(buttonIn(APPROVE_TITLE, "Approve"));
      expect(mockTransition).toHaveBeenCalledTimes(1);
      expect(onOpenChange).not.toHaveBeenCalled();

      request.resolve({ updated: 24 });
      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
      expect(mockTransition).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the server refuses", () => {
    it("keeps a segregation-of-duties 422 inline, open, and refreshes nothing", async () => {
      const issue = "You prepared this batch, so you cannot approve it.";
      mockTransition.mockRejectedValue(unprocessable("non_field", issue));
      const { user, onOpenChange, invalidate } = renderTransition("approve");

      await user.click(buttonIn(APPROVE_TITLE, "Approve"));

      expect(await within(dialogOf(APPROVE_TITLE)).findByText(issue)).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(invalidate).not.toHaveBeenCalled();
      expect(buttonIn(APPROVE_TITLE, "Approve")).toBeEnabled();
    });

    it("shows the override-reason count a submit is refused with", async () => {
      const issue = "An override reason is required where the decision differs. Missing for 3.";
      mockTransition.mockRejectedValue(unprocessable("override_reason", issue));
      const { user, onOpenChange } = renderTransition("submit");

      await user.click(buttonIn(SUBMIT_TITLE, "Submit for approval"));

      expect(await screen.findByText(issue)).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it("shows a status race inline and reloads the batch, not the list", async () => {
      const issue = "This batch changed while the action was running.";
      mockTransition.mockRejectedValue(refusal(409, "conflict", "non_field", issue));
      const { user, onOpenChange, invalidate } = renderTransition("approve");

      await user.click(buttonIn(APPROVE_TITLE, "Approve"));

      expect(await screen.findByText(issue)).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(invalidate).toHaveBeenCalledTimes(1);
      expect(invalidate).toHaveBeenCalledWith({ queryKey: DETAIL_KEY });
    });

    it("falls back to a generic message for a failure that isn't an API error", async () => {
      mockTransition.mockRejectedValue(new TypeError("Failed to fetch"));
      const { user } = renderTransition("reject");

      await user.click(buttonIn(REJECT_TITLE, "Reject"));

      const fallback = "Something went wrong. Please try again.";
      expect(await screen.findByText(fallback)).toBeInTheDocument();
    });

    it("clears the message on a retry, reusing the key, and closes once it succeeds", async () => {
      mockTransition.mockRejectedValueOnce(unprocessable("non_field", "Not yet."));
      const { user, onOpenChange } = renderTransition("approve");

      await user.click(buttonIn(APPROVE_TITLE, "Approve"));
      expect(await screen.findByText("Not yet.")).toBeInTheDocument();
      await user.click(buttonIn(APPROVE_TITLE, "Approve"));

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
      expect(screen.queryByText("Not yet.")).not.toBeInTheDocument();
      expect(mockTransition).toHaveBeenCalledTimes(2);
      // One key per dialog instance, kept for the retry.
      expect(mockTransition.mock.calls[1]?.[2]).toBe(mockTransition.mock.calls[0]?.[2]);
    });
  });

  it("takes a new key for each dialog instance", async () => {
    const first = renderTransition("approve");
    await first.user.click(buttonIn(APPROVE_TITLE, "Approve"));
    await waitFor(() => {
      expect(first.onOpenChange).toHaveBeenCalledWith(false);
    });
    first.unmount();

    const second = renderTransition("approve");
    await second.user.click(buttonIn(APPROVE_TITLE, "Approve"));
    await waitFor(() => {
      expect(second.onOpenChange).toHaveBeenCalledWith(false);
    });

    expect(mockTransition).toHaveBeenCalledTimes(2);
    expect(mockTransition.mock.calls[1]?.[2]).not.toBe(mockTransition.mock.calls[0]?.[2]);
  });

  describe("executing", () => {
    it("hands the run to the execution and refreshes nothing itself", async () => {
      const onExecute = jest.fn().mockResolvedValue(undefined);
      const { user, onOpenChange, invalidate } = renderExecute(onExecute);

      await user.click(buttonIn(EXECUTE_TITLE, "Execute"));

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
      expect(onExecute).toHaveBeenCalledTimes(1);
      expect(mockTransition).not.toHaveBeenCalled();
      // Queued is not done: the job reloads the batch when it ends.
      expect(invalidate).not.toHaveBeenCalled();
    });

    it("shows a refusal of the run inline and stays open", async () => {
      const issue = "Only an approved batch can be executed.";
      const onExecute = jest.fn().mockRejectedValue(refusal(409, "conflict", "non_field", issue));
      const { user, onOpenChange } = renderExecute(onExecute);

      await user.click(buttonIn(EXECUTE_TITLE, "Execute"));

      expect(await screen.findByText(issue)).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalled();
    });
  });
});
