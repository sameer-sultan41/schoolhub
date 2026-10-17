import { ApiError } from "@schoolhub/api-client";
import type { AuthenticatedUser, PermissionKey } from "@schoolhub/types";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useJobPolling, type JobPollingResult } from "@/hooks/use-job-polling";
import { queryKeys } from "@/lib/query-client";
import { Services, type PromotionBatchDetail, type PromotionStatus } from "@/services";
import {
  BATCH_ID,
  jobRecord,
  promotionBatchDetail,
  promotionDecision,
  studentUuid,
  unprocessable,
} from "@/services/modules/promotions/__tests__/promotions-fixtures";
import {
  PROMOTION_BATCH_RESOURCE,
  PROMOTION_BATCHES_RESOURCE,
  PROMOTION_QUERY_MODULE,
} from "@/services/modules/promotions/promotions-constant";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { buildUser, renderWithClient } from "@/test-utils";

import { PromotionBatchActions } from "../promotion-batch-actions";

// What the execute job reports is each test's to decide; the real poll is `useJobPolling`'s own
// test, and the hook that drives it is `use-promotion-execution.test.tsx`.
jest.mock("@/hooks/use-job-polling", () => ({ useJobPolling: jest.fn() }));

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    auth: { fetchCurrentUser: jest.fn() },
    promotions: { transitionBatch: jest.fn(), executeBatch: jest.fn() },
  },
}));

const mockUseJobPolling = useJobPolling as jest.MockedFunction<typeof useJobPolling>;
const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;
const mockTransition = Services.promotions.transitionBatch as jest.MockedFunction<
  typeof Services.promotions.transitionBatch
>;
const mockExecute = Services.promotions.executeBatch as jest.MockedFunction<
  typeof Services.promotions.executeBatch
>;

type User = ReturnType<typeof userEvent.setup>;
type ButtonCase = [PromotionStatus, string, PermissionKey];

const UPDATE: PermissionKey = "academics.promotion.update";
const APPROVE: PermissionKey = "academics.promotion.approve";
const EXECUTE: PermissionKey = "academics.promotion.execute";
const ALL_KEYS = [UPDATE, APPROVE, EXECUTE];

const SUBMIT_TITLE = "Submit this batch for approval?";
const APPROVE_TITLE = "Approve this batch?";
const REJECT_TITLE = "Reject this batch?";
const EXECUTE_TITLE = "Execute this batch?";

/** Each status's buttons, in order, with the key each needs: the module doc's table, written out
 * here and not read back from the component, so a changed matrix fails. */
const MATRIX: [PromotionStatus, [string, PermissionKey][]][] = [
  [
    "draft",
    [
      ["Submit for approval", UPDATE],
      ["Revert", UPDATE],
    ],
  ],
  [
    "pending_approval",
    [
      ["Approve", APPROVE],
      ["Reject", APPROVE],
      ["Revert", UPDATE],
    ],
  ],
  [
    "approved",
    [
      ["Execute", EXECUTE],
      ["Revert", UPDATE],
    ],
  ],
  ["executed", [["Revert", UPDATE]]],
  ["reverted", []],
];

/** The statuses the missing-section advisory is not shown in (it is for draft and approved). */
const QUIET_STATUSES: PromotionStatus[] = ["pending_approval", "executed", "reverted"];

const BUTTONS = MATRIX.flatMap(([status, buttons]) =>
  buttons.map(([label, key]): ButtonCase => [status, label, key]),
);

const DETAIL_KEY = queryKeys.detail(PROMOTION_QUERY_MODULE, PROMOTION_BATCH_RESOURCE, BATCH_ID);
const LIST_KEY = queryKeys.list(PROMOTION_QUERY_MODULE, PROMOTION_BATCHES_RESOURCE);
const LIST_PAGE_KEY = queryKeys.list(PROMOTION_QUERY_MODULE, PROMOTION_BATCHES_RESOURCE, {
  page: 1,
});
const BARE_KEY = queryKeys.module(PROMOTION_QUERY_MODULE);
const JOB_WATCH_KEY = queryKeys.jobWatch(PROMOTION_QUERY_MODULE, "job-1", 0);

const mockResume = jest.fn();
const NOT_WATCHING: JobPollingResult = {
  job: undefined,
  isPolling: false,
  isTimedOut: false,
  isError: false,
  error: null,
  resume: mockResume,
};
/** What the execute job reports once the hook is watching it. */
let watching: JobPollingResult = NOT_WATCHING;

async function renderActions(batch: PromotionBatchDetail, permissions: PermissionKey[]) {
  mockFetchCurrentUser.mockResolvedValue(buildUser(permissions));
  const view = renderWithClient(
    <>
      <PromotionBatchActions batch={batch} />
      <UserLoaded />
    </>,
  );
  await screen.findByText(USER_LOADED);
  const invalidate = jest.spyOn(view.queryClient, "invalidateQueries");
  return { ...view, invalidate, user: userEvent.setup() };
}

function inStatus(status: PromotionStatus) {
  return promotionBatchDetail({ status });
}

function buttonNames() {
  return screen.queryAllByRole("button").map((button) => button.textContent);
}

function dialogOf(title: string) {
  return screen.getByRole("alertdialog", { name: title });
}

function confirmButton(title: string, label: string) {
  return within(dialogOf(title)).getByRole("button", { name: label });
}

/** Opens a dialog from the page's own button, then confirms it with the dialog's. */
async function openAndConfirm(user: User, label: string, title: string) {
  await user.click(screen.getByRole("button", { name: label }));
  await user.click(confirmButton(title, label));
}

describe("PromotionBatchActions", () => {
  beforeEach(() => {
    watching = NOT_WATCHING;
    mockUseJobPolling.mockImplementation((_module, jobId) =>
      jobId === null ? NOT_WATCHING : watching,
    );
    mockFetchCurrentUser.mockReset();
    mockTransition.mockReset().mockResolvedValue({ updated: 1 });
    mockExecute.mockReset().mockResolvedValue({ job_id: "job-1", status: "queued" });
    mockResume.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the status and permission matrix", () => {
    it.each(MATRIX)("%s: offers its buttons, in order", async (status, buttons) => {
      await renderActions(inStatus(status), ALL_KEYS);

      expect(buttonNames()).toEqual(buttons.map(([label]) => label));
    });

    it.each(BUTTONS)("%s: withholds %s without %s", async (status, label, key) => {
      const others = ALL_KEYS.filter((held) => held !== key);
      await renderActions(inStatus(status), others);

      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    });

    it.each(BUTTONS)("%s: offers %s to a holder of only %s", async (status, label, key) => {
      await renderActions(inStatus(status), [key]);

      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    });

    it("offers nothing to a viewer with none of the keys", async () => {
      await renderActions(inStatus("pending_approval"), []);

      expect(buttonNames()).toEqual([]);
    });

    it("offers nothing while the viewer's permissions are still loading", async () => {
      mockFetchCurrentUser.mockReturnValue(new Promise<AuthenticatedUser>(() => undefined));
      renderWithClient(<PromotionBatchActions batch={inStatus("draft")} />);

      await waitFor(() => {
        expect(mockFetchCurrentUser).toHaveBeenCalled();
      });
      expect(buttonNames()).toEqual([]);
    });

    it("offers the buttons once the permissions arrive", async () => {
      mockFetchCurrentUser.mockResolvedValue(buildUser(ALL_KEYS));
      renderWithClient(<PromotionBatchActions batch={inStatus("draft")} />);

      expect(await screen.findByRole("button", { name: "Revert" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Submit for approval" })).toBeInTheDocument();
    });
  });

  describe("the confirm dialogs", () => {
    it("asks first: nothing is sent until confirmed, and cancelling sends nothing", async () => {
      const { user } = await renderActions(inStatus("draft"), ALL_KEYS);

      await user.click(screen.getByRole("button", { name: "Submit for approval" }));

      expect(mockTransition).not.toHaveBeenCalled();
      await user.click(within(dialogOf(SUBMIT_TITLE)).getByRole("button", { name: "Cancel" }));
      await waitFor(() => {
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      });
      expect(mockTransition).not.toHaveBeenCalled();
    });

    it("sends the button's own action once confirmed", async () => {
      const { user } = await renderActions(inStatus("pending_approval"), ALL_KEYS);

      await openAndConfirm(user, "Reject", REJECT_TITLE);

      await waitFor(() => {
        expect(mockTransition).toHaveBeenCalledWith(BATCH_ID, "reject", expect.any(String));
      });
      expect(mockTransition).toHaveBeenCalledTimes(1);
    });

    it("keeps the preparer's refusal to approve their own batch inline", async () => {
      const issue = "You prepared this batch, so you cannot approve it.";
      mockTransition.mockRejectedValue(unprocessable("non_field", issue));
      const { user, invalidate } = await renderActions(inStatus("pending_approval"), ALL_KEYS);

      await openAndConfirm(user, "Approve", APPROVE_TITLE);

      expect(await within(dialogOf(APPROVE_TITLE)).findByText(issue)).toBeInTheDocument();
      expect(invalidate).not.toHaveBeenCalled();
      // Still the dialog to retry or cancel from.
      expect(within(dialogOf(APPROVE_TITLE)).getByRole("button", { name: "Cancel" })).toBeEnabled();
    });

    it("keeps one key for a dialog's retries, a new one for the next", async () => {
      const offline = new ApiError({
        code: "network_error",
        message: "offline",
        status: 0,
        url: "/student-promotions",
      });
      mockTransition.mockRejectedValueOnce(offline);
      const { user } = await renderActions(inStatus("pending_approval"), ALL_KEYS);

      await openAndConfirm(user, "Approve", APPROVE_TITLE);
      await within(dialogOf(APPROVE_TITLE)).findByText(/could not reach the server/i);
      await user.click(confirmButton(APPROVE_TITLE, "Approve"));
      await waitFor(() => {
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      });
      // The page still offers Approve (nothing refetched the batch here): a new dialog.
      await openAndConfirm(user, "Approve", APPROVE_TITLE);

      await waitFor(() => {
        expect(mockTransition).toHaveBeenCalledTimes(3);
      });
      const keys = mockTransition.mock.calls.map(([, , key]) => key);
      expect(keys[1]).toBe(keys[0]);
      expect(keys[2]).not.toBe(keys[1]);
    });

    it("refreshes the batch and list on success, never the execute poll", async () => {
      const { user, queryClient, invalidate } = await renderActions(
        inStatus("pending_approval"),
        ALL_KEYS,
      );
      // What the promotions module has cached: the batch, a page of the list, and a running poll.
      queryClient.setQueryData(DETAIL_KEY, inStatus("pending_approval"));
      queryClient.setQueryData(LIST_PAGE_KEY, []);
      queryClient.setQueryData(JOB_WATCH_KEY, jobRecord("running"));

      await openAndConfirm(user, "Approve", APPROVE_TITLE);

      await waitFor(() => {
        expect(invalidate).toHaveBeenCalledWith({ queryKey: DETAIL_KEY });
      });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: LIST_KEY });
      expect(invalidate).not.toHaveBeenCalledWith({ queryKey: BARE_KEY });
      expect(queryClient.getQueryState(DETAIL_KEY)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(LIST_PAGE_KEY)?.isInvalidated).toBe(true);
      // The poll's entry shares the `["promotions"]` prefix, and stays untouched.
      expect(queryClient.getQueryState(JOB_WATCH_KEY)?.isInvalidated).toBe(false);
    });
  });

  describe("the missing-section notice", () => {
    /** Ayesha has a section; Bilal and Zainab need one and have none; Usman graduates. */
    const ayesha = promotionDecision({ student_name: "Ayesha Khan" });
    const bilal = promotionDecision({
      student_id: studentUuid(2),
      student_name: "Bilal Ahmed",
      to_section_id: null,
      to_section_name: null,
    });
    const zainab = promotionDecision({
      student_id: studentUuid(3),
      student_name: "Zainab Qureshi",
      decision: "retained",
      to_section_id: null,
      to_section_name: null,
    });
    const usman = promotionDecision({
      student_id: studentUuid(4),
      student_name: "Usman Ali",
      decision: "graduated",
      to_class_id: null,
      to_class_name: null,
      to_section_id: null,
      to_section_name: null,
    });
    const decisions = [ayesha, bilal, zainab, usman];
    const NOTICE = "2 students have no target section and will fail on execute";
    const LOCKED_NOTICE =
      NOTICE + ". Sections can no longer be set in this batch: revert it and create a new one.";

    it("counts them in a draft, a graduate excepted", async () => {
      await renderActions(promotionBatchDetail({ status: "draft", decisions }), ALL_KEYS);

      expect(screen.getByText(NOTICE)).toBeInTheDocument();
      expect(screen.queryByText(/no longer be set/)).not.toBeInTheDocument();
    });

    it("says in approved that sections can no longer be set, and what to do instead", async () => {
      await renderActions(promotionBatchDetail({ status: "approved", decisions }), ALL_KEYS);

      expect(screen.getByText(LOCKED_NOTICE)).toBeInTheDocument();
    });

    it("says it in the singular for one student", async () => {
      await renderActions(promotionBatchDetail({ decisions: [ayesha, bilal] }), ALL_KEYS);

      const singular = "1 student has no target section and will fail on execute";
      expect(screen.getByText(singular)).toBeInTheDocument();
    });

    it("hides when every student who needs a section has one", async () => {
      await renderActions(promotionBatchDetail({ decisions: [ayesha, usman] }), ALL_KEYS);

      expect(screen.queryByText(/no target section/)).not.toBeInTheDocument();
    });

    it.each(QUIET_STATUSES)("is not shown in %s", async (status) => {
      await renderActions(promotionBatchDetail({ status, decisions }), ALL_KEYS);

      expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    });

    it("is advisory: submit stays enabled with students lacking a section", async () => {
      await renderActions(promotionBatchDetail({ status: "draft", decisions }), ALL_KEYS);

      expect(screen.getByText(NOTICE)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Submit for approval" })).toBeEnabled();
    });

    it("is advisory: execute stays enabled with students lacking a section", async () => {
      await renderActions(promotionBatchDetail({ status: "approved", decisions }), ALL_KEYS);

      expect(screen.getByText(LOCKED_NOTICE)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Execute" })).toBeEnabled();
    });
  });

  describe("executing", () => {
    async function startExecuting(batch: PromotionBatchDetail = inStatus("approved")) {
      const view = await renderActions(batch, ALL_KEYS);
      await openAndConfirm(view.user, "Execute", EXECUTE_TITLE);
      await waitFor(() => {
        expect(mockExecute).toHaveBeenCalledWith(BATCH_ID, expect.any(String));
      });
      // Queued: the dialog has done its part, and the page behind it is reachable again.
      await waitFor(() => {
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      });
      return view;
    }

    it("closes once queued, and shows the job's progress with the buttons held", async () => {
      watching = { ...NOT_WATCHING, job: jobRecord("running", { progress: 40 }), isPolling: true };

      await startExecuting();

      expect(await screen.findByText("Executing — 40%")).toBeInTheDocument();
      const execute = screen.getByRole("button", { name: /Execute/ });
      expect(execute).toBeDisabled();
      expect(execute).toHaveAttribute("aria-busy", "true");
      expect(screen.getByRole("button", { name: "Revert" })).toBeDisabled();
    });

    it("holds Execute once the job succeeded, and lists who failed by name", async () => {
      const bilal = promotionDecision({
        student_id: studentUuid(2),
        student_name: "Bilal Ahmed",
        admission_number: "ADM-0002",
      });
      const result = {
        enrolled: [{ student_id: studentUuid(1) }],
        graduated: [],
        skipped: [],
        failed: [
          {
            student_id: studentUuid(2),
            error: "Assign a target section before executing this batch.",
          },
        ],
      };
      watching = { ...NOT_WATCHING, job: jobRecord("succeeded", { result }) };

      await startExecuting(
        promotionBatchDetail({ status: "approved", decisions: [promotionDecision(), bilal] }),
      );

      expect(await screen.findByText("Failed: 1")).toBeInTheDocument();
      const line = "Bilal Ahmed (ADM-0002): Assign a target section before executing this batch.";
      expect(screen.getByText(line)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Execute" })).toBeDisabled();
    });

    it("says so when the job failed, and lets it be run again", async () => {
      watching = { ...NOT_WATCHING, job: jobRecord("failed", { error: "boom" }) };

      await startExecuting();

      expect(await screen.findByText("The execution job failed.")).toBeInTheDocument();
      expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Execute" })).toBeEnabled();
    });

    it("offers to keep watching a job that timed out, without running it again", async () => {
      watching = { ...NOT_WATCHING, job: jobRecord("running"), isTimedOut: true };
      const { user } = await startExecuting();

      await user.click(await screen.findByRole("button", { name: "Check again" }));

      expect(mockResume).toHaveBeenCalledTimes(1);
      expect(mockExecute).toHaveBeenCalledTimes(1);
      // No longer watched is not finished: running it again would start a second execution.
      expect(screen.getByRole("button", { name: "Execute" })).toBeDisabled();
    });

    it("shows a refusal of the run inline, in the open dialog", async () => {
      const issue = "Only an approved batch can be executed.";
      mockExecute.mockRejectedValue(unprocessable("non_field", issue));
      const { user } = await renderActions(inStatus("approved"), ALL_KEYS);

      await openAndConfirm(user, "Execute", EXECUTE_TITLE);

      expect(await within(dialogOf(EXECUTE_TITLE)).findByText(issue)).toBeInTheDocument();
      expect(screen.queryByText(/Executing/)).not.toBeInTheDocument();
    });
  });
});
