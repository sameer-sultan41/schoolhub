import { ApiError } from "@schoolhub/api-client";
import { act, waitFor } from "@testing-library/react";

import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import type { JobAccepted } from "@/services/modules/jobs/jobs-service";
import {
  apiError,
  BATCH_ID,
  deferred,
  jobRecord,
  studentUuid,
} from "@/services/modules/promotions/__tests__/promotions-fixtures";
import {
  PROMOTION_BATCH_RESOURCE,
  PROMOTION_BATCHES_RESOURCE,
  PROMOTION_QUERY_MODULE,
} from "@/services/modules/promotions/promotions-constant";
import { renderHookWithClient } from "@/test-utils";

import { usePromotionExecution } from "../use-promotion-execution";

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: { promotions: { executeBatch: jest.fn() }, jobs: { fetchJob: jest.fn() } },
}));

const mockExecute = Services.promotions.executeBatch as jest.MockedFunction<
  typeof Services.promotions.executeBatch
>;
const mockFetchJob = Services.jobs.fetchJob as jest.MockedFunction<typeof Services.jobs.fetchJob>;

const DETAIL_KEY = queryKeys.detail(PROMOTION_QUERY_MODULE, PROMOTION_BATCH_RESOURCE, BATCH_ID);
const LIST_KEY = queryKeys.list(PROMOTION_QUERY_MODULE, PROMOTION_BATCHES_RESOURCE);
const BARE_KEY = queryKeys.module(PROMOTION_QUERY_MODULE);

const ACCEPTED: JobAccepted = { job_id: "job-1", status: "queued" };

/** A batch executed with one student enrolled and one failed for want of a section. */
const REPORT = {
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

function setup() {
  const view = renderHookWithClient(() => usePromotionExecution(BATCH_ID));
  const invalidate = jest.spyOn(view.queryClient, "invalidateQueries");
  return { ...view, invalidate };
}

describe("usePromotionExecution", () => {
  beforeEach(() => {
    jest.useFakeTimers({ advanceTimers: true });
    mockExecute.mockReset();
    mockFetchJob.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("sends one request however often it is started while one is in flight", async () => {
    const request = deferred<JobAccepted>();
    mockExecute.mockReturnValue(request.promise);
    mockFetchJob.mockResolvedValue(jobRecord("running"));
    const { result } = setup();

    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.start();
      second = result.current.start();
    });

    expect(result.current.isRunning).toBe(true);
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);

    await act(async () => {
      request.resolve(ACCEPTED);
      await first;
    });
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledWith(BATCH_ID, expect.any(String));
  });

  it("retries a failed request under the same key, and a later run under a new one", async () => {
    const offline = apiError(0, "network_error");
    mockExecute.mockRejectedValueOnce(offline).mockResolvedValue(ACCEPTED);
    mockFetchJob.mockResolvedValue(jobRecord("failed"));
    const { result } = setup();

    await act(async () => {
      await expect(result.current.start()).rejects.toBe(offline);
    });
    expect(result.current.isRunning).toBe(false);

    // The retry: the first request may have been queued with its response lost.
    await act(async () => {
      await result.current.start();
    });
    await waitFor(() => {
      expect(result.current.hasFailed).toBe(true);
    });

    // The run was accepted and ended: running again is a new intent, so a new key.
    await act(async () => {
      await result.current.start();
    });

    const keys = mockExecute.mock.calls.map(([, key]) => key);
    expect(keys).toHaveLength(3);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it("reloads the batch and the list when the job succeeds, not the bare key", async () => {
    mockExecute.mockResolvedValue(ACCEPTED);
    mockFetchJob
      .mockResolvedValueOnce(jobRecord("running", { progress: 40 }))
      .mockResolvedValue(jobRecord("succeeded", { result: REPORT }));
    const { result, invalidate } = setup();

    await act(async () => {
      await result.current.start();
    });
    await waitFor(() => {
      expect(result.current.progress).toBe(40);
    });
    // Queued is not done: the batch is still approved, so there is nothing to refetch yet.
    expect(result.current.isRunning).toBe(true);
    expect(invalidate).not.toHaveBeenCalled();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    await waitFor(() => {
      expect(result.current.hasSucceeded).toBe(true);
    });

    expect(result.current.report).toEqual(REPORT);
    expect(result.current.isRunning).toBe(false);
    expect(result.current.hasFailed).toBe(false);
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: DETAIL_KEY });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: LIST_KEY });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: BARE_KEY });
  });

  it("reports a failed job with no report, and reloads the batch it may have moved", async () => {
    mockExecute.mockResolvedValue(ACCEPTED);
    mockFetchJob.mockResolvedValue(jobRecord("failed", { error: "boom" }));
    const { result, invalidate } = setup();

    await act(async () => {
      await result.current.start();
    });

    await waitFor(() => {
      expect(result.current.hasFailed).toBe(true);
    });
    expect(result.current.report).toBeNull();
    expect(result.current.hasSucceeded).toBe(false);
    expect(result.current.isRunning).toBe(false);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: DETAIL_KEY });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: BARE_KEY });
  });

  it("reads a succeeded job whose result is not a report as a failure, not a crash", async () => {
    mockExecute.mockResolvedValue(ACCEPTED);
    mockFetchJob.mockResolvedValue(jobRecord("succeeded", { result: { count: 3 } }));
    const { result } = setup();

    await act(async () => {
      await result.current.start();
    });

    await waitFor(() => {
      expect(result.current.hasSucceeded).toBe(true);
    });
    expect(result.current.report).toBeNull();
    expect(result.current.hasFailed).toBe(true);
  });

  it("stalls when the poll times out, and resume watches the same job again", async () => {
    mockExecute.mockResolvedValue(ACCEPTED);
    mockFetchJob.mockResolvedValue(jobRecord("running"));
    const { result } = setup();

    await act(async () => {
      await result.current.start();
    });
    await waitFor(() => {
      expect(mockFetchJob).toHaveBeenCalled();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(120_000);
    });
    await waitFor(() => {
      expect(result.current.isStalled).toBe(true);
    });
    // No longer watched is not finished: it stays a run in progress, so it can't be started again.
    expect(result.current.isRunning).toBe(true);
    const callsAtStall = mockFetchJob.mock.calls.length;

    // The job finished server-side while nobody was watching it.
    mockFetchJob.mockResolvedValue(jobRecord("succeeded", { result: REPORT }));
    act(() => {
      result.current.resume();
    });

    await waitFor(() => {
      expect(result.current.hasSucceeded).toBe(true);
    });
    expect(result.current.isStalled).toBe(false);
    expect(mockFetchJob.mock.calls.length).toBeGreaterThan(callsAtStall);
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("stalls, rather than fails, when a poll request is lost to the network", async () => {
    mockExecute.mockResolvedValue(ACCEPTED);
    mockFetchJob.mockRejectedValue(apiError(0, "network_error"));
    const { result } = setup();

    await act(async () => {
      await result.current.start();
    });

    await waitFor(() => {
      expect(result.current.isStalled).toBe(true);
    });
    expect(result.current.hasFailed).toBe(false);
    expect(result.current.isRunning).toBe(true);
  });

  it("treats a poll the server refused as a failed run and releases it", async () => {
    mockExecute.mockResolvedValue(ACCEPTED);
    mockFetchJob.mockRejectedValue(apiError(404, "not_found"));
    const { result } = setup();

    await act(async () => {
      await result.current.start();
    });

    await waitFor(() => {
      expect(result.current.hasFailed).toBe(true);
    });
    expect(result.current.isStalled).toBe(false);
    expect(result.current.isRunning).toBe(false);
  });

  it("reloads only the batch when the request loses a race, and still rejects", async () => {
    const conflict = apiError(409, "conflict");
    mockExecute.mockRejectedValue(conflict);
    const { result, invalidate } = setup();

    await act(async () => {
      await expect(result.current.start()).rejects.toBe(conflict);
    });

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: DETAIL_KEY });
    expect(result.current.isRunning).toBe(false);
  });

  it("does not refetch anything for a refusal that is not a race", async () => {
    mockExecute.mockRejectedValue(apiError(422, "domain_rule_violation"));
    const { result, invalidate } = setup();

    await act(async () => {
      await expect(result.current.start()).rejects.toBeInstanceOf(ApiError);
    });

    expect(invalidate).not.toHaveBeenCalled();
  });
});
