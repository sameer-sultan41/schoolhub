import { ApiError } from "@schoolhub/api-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { makeQueryClient } from "@/lib/query-client";
import { Services } from "@/services";
import type { BackgroundJobRecord, JobStatus } from "@/services/modules/jobs/jobs-service";

import { useJobPolling } from "../use-job-polling";

jest.mock("@/services", () => ({
  Services: { jobs: { fetchJob: jest.fn() } },
}));

const mockFetchJob = Services.jobs.fetchJob as jest.MockedFunction<typeof Services.jobs.fetchJob>;

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

/** One client for the whole test — `wrapper` above builds a new one on every `rerender`,
 * which would hide exactly the cached-state inheritance these tests exist to catch. */
function stableWrapper(
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return function StableWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function jobRecord(id: string, status: JobStatus): BackgroundJobRecord {
  return {
    id,
    job_type: "export.staff",
    status,
    progress: status === "succeeded" ? 100 : 0,
    result: status === "succeeded" ? { result_file_id: "file-1" } : null,
    error: null,
  };
}

describe("useJobPolling", () => {
  beforeEach(() => {
    jest.useFakeTimers({ advanceTimers: true });
    mockFetchJob.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("does nothing while jobId is null", () => {
    const { result } = renderHook(() => useJobPolling("staff", null), { wrapper });
    expect(result.current.job).toBeUndefined();
    expect(result.current.isPolling).toBe(false);
    expect(mockFetchJob).not.toHaveBeenCalled();
  });

  it("polls until the job reaches succeeded, then stops", async () => {
    mockFetchJob
      .mockResolvedValueOnce({
        id: "job-1",
        job_type: "export.staff",
        status: "running",
        progress: 10,
        result: null,
        error: null,
      })
      .mockResolvedValueOnce({
        id: "job-1",
        job_type: "export.staff",
        status: "succeeded",
        progress: 100,
        result: { result_file_id: "file-1" },
        error: null,
      });

    const { result } = renderHook(() => useJobPolling("staff", "job-1"), { wrapper });

    await waitFor(() => {
      expect(result.current.job?.status).toBe("running");
    });
    expect(result.current.isPolling).toBe(true);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });

    await waitFor(() => {
      expect(result.current.job?.status).toBe("succeeded");
    });
    expect(result.current.isPolling).toBe(false);

    const callsAtSuccess = mockFetchJob.mock.calls.length;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10_000);
    });
    // No further polling once terminal — a third call would mean refetchInterval
    // didn't actually stop.
    expect(mockFetchJob.mock.calls.length).toBe(callsAtSuccess);
  });

  it("times out — and the timeout actually reaches a re-render — when the job never reaches a terminal status", async () => {
    mockFetchJob.mockResolvedValue({
      id: "job-2",
      job_type: "export.staff",
      status: "running",
      progress: 0,
      result: null,
      error: null,
    });

    const { result } = renderHook(() => useJobPolling("staff", "job-2"), { wrapper });

    await waitFor(() => {
      expect(result.current.isPolling).toBe(true);
    });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(120_000);
    });

    // This assertion is the one the first review round's plan failed: a hook that
    // merely computes `isTimedOut` correctly but never re-renders would leave
    // `result.current` stuck at its last-observed value, and `waitFor` would time out.
    await waitFor(() => {
      expect(result.current.isTimedOut).toBe(true);
    });
    expect(result.current.isPolling).toBe(false);
  });

  it("gives a freshly-triggered job its own full timeout budget, not the previous job's", async () => {
    mockFetchJob.mockResolvedValue({
      id: "job-a",
      job_type: "export.staff",
      status: "running",
      progress: 0,
      result: null,
      error: null,
    });

    const { result, rerender } = renderHook(
      ({ jobId }: { jobId: string }) => useJobPolling("staff", jobId),
      { wrapper, initialProps: { jobId: "job-a" } },
    );

    await act(async () => {
      await jest.advanceTimersByTimeAsync(120_000);
    });
    await waitFor(() => {
      expect(result.current.isTimedOut).toBe(true);
    });

    rerender({ jobId: "job-b" });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(10_000);
    });
    // Only 10s of job-b's own 120s budget has elapsed — a hook that carried over
    // job-a's already-expired timer would report this as timed out immediately.
    expect(result.current.isTimedOut).toBe(false);
    expect(result.current.isPolling).toBe(true);
  });

  it("never reports isTimedOut for a job that already succeeded, even long after", async () => {
    mockFetchJob.mockResolvedValue({
      id: "job-4",
      job_type: "export.staff",
      status: "succeeded",
      progress: 100,
      result: { result_file_id: "file-1" },
      error: null,
    });

    const { result } = renderHook(() => useJobPolling("staff", "job-4"), { wrapper });

    await waitFor(() => {
      expect(result.current.job?.status).toBe("succeeded");
    });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(130_000);
    });

    // A job that finished successfully must never be reported as timed out just
    // because the 120s budget set on mount eventually runs out.
    expect(result.current.isTimedOut).toBe(false);
  });

  it("clears the timeout timer as soon as the job reaches a terminal status", async () => {
    mockFetchJob.mockResolvedValue(jobRecord("job-5", "succeeded"));

    let renders = 0;
    const { result } = renderHook(
      () => {
        renders += 1;
        return useJobPolling("staff", "job-5");
      },
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.job?.status).toBe("succeeded");
    });
    const rendersAtSuccess = renders;

    await act(async () => {
      await jest.advanceTimersByTimeAsync(130_000);
    });

    // Nothing else changes once the job is terminal — a timer still running underneath
    // would fire at 120s and force one more render of an already-finished job.
    expect(renders).toBe(rendersAtSuccess);
  });

  it("resume() after a timeout polls the same job again, with a new full budget", async () => {
    mockFetchJob.mockResolvedValue(jobRecord("job-6", "running"));

    const { result } = renderHook(() => useJobPolling("staff", "job-6"), {
      wrapper: stableWrapper(),
    });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(120_000);
    });
    await waitFor(() => {
      expect(result.current.isTimedOut).toBe(true);
    });
    const callsAtTimeout = mockFetchJob.mock.calls.length;

    act(() => {
      result.current.resume();
    });

    await waitFor(() => {
      expect(result.current.isPolling).toBe(true);
    });
    expect(result.current.isTimedOut).toBe(false);
    expect(mockFetchJob.mock.calls.length).toBeGreaterThan(callsAtTimeout);

    // 110s into the resumed watch: an inherited, already-expired budget would have
    // timed this out immediately.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(110_000);
    });
    expect(result.current.isTimedOut).toBe(false);
    expect(result.current.isPolling).toBe(true);

    mockFetchJob.mockResolvedValue(jobRecord("job-6", "succeeded"));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    await waitFor(() => {
      expect(result.current.job?.status).toBe("succeeded");
    });
  });

  it("resume() after a poll error polls again and clears the error", async () => {
    mockFetchJob.mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => useJobPolling("staff", "job-7"), {
      wrapper: stableWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toBeInstanceOf(Error);

    mockFetchJob.mockResolvedValue(jobRecord("job-7", "running"));
    act(() => {
      result.current.resume();
    });

    await waitFor(() => {
      expect(result.current.job?.status).toBe("running");
    });
    expect(result.current.isError).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.isPolling).toBe(true);
  });

  it("gives a job watched again after jobId went null a fresh watch, not its previous timed-out one", async () => {
    mockFetchJob.mockResolvedValue(jobRecord("job-8", "running"));

    // Typed up front, so `rerender({ jobId: null })` below is a legal props value.
    const initialProps: { jobId: string | null } = { jobId: "job-8" };
    const { result, rerender } = renderHook(({ jobId }) => useJobPolling("staff", jobId), {
      wrapper: stableWrapper(),
      initialProps,
    });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(120_000);
    });
    await waitFor(() => {
      expect(result.current.isTimedOut).toBe(true);
    });

    // A dialog closing (`open ? jobId : null`) and reopening on the same job.
    rerender({ jobId: null });
    expect(result.current.isPolling).toBe(false);
    const callsWhileClosed = mockFetchJob.mock.calls.length;

    rerender({ jobId: "job-8" });

    await waitFor(() => {
      expect(mockFetchJob.mock.calls.length).toBeGreaterThan(callsWhileClosed);
    });
    expect(result.current.isTimedOut).toBe(false);
    expect(result.current.isPolling).toBe(true);
  });

  describe("under the app's own retry policy (makeQueryClient's shouldRetry)", () => {
    function apiError(status: number) {
      return new ApiError({
        code: status === 404 ? "not_found" : "service_unavailable",
        message: status === 404 ? "Not found." : "Service unavailable.",
        status,
        url: "/jobs/job-9",
      });
    }

    it("retries a transient ApiError rather than reporting isError on the first failed poll", async () => {
      mockFetchJob
        .mockRejectedValueOnce(apiError(503))
        .mockResolvedValue(jobRecord("job-9", "running"));

      const { result } = renderHook(() => useJobPolling("staff", "job-9"), {
        wrapper: stableWrapper(makeQueryClient()),
      });

      // TanStack Query's default backoff: the first retry fires 1s after the failure.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000);
      });

      await waitFor(() => {
        expect(result.current.job?.status).toBe("running");
      });
      expect(result.current.isError).toBe(false);
      expect(result.current.isPolling).toBe(true);
    });

    it("reports isError only once a transient failure outlasts both retries", async () => {
      mockFetchJob.mockRejectedValue(apiError(503));

      const { result } = renderHook(() => useJobPolling("staff", "job-9"), {
        wrapper: stableWrapper(makeQueryClient()),
      });

      // 1s + 2s of backoff between the first poll and the last retry.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(5000);
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
      // The first poll plus shouldRetry's two retries — then polling stops.
      expect(mockFetchJob).toHaveBeenCalledTimes(3);
      expect(result.current.isPolling).toBe(false);
    });

    it("does not retry a non-transient ApiError — a 404 is an answer, not a blip", async () => {
      mockFetchJob.mockRejectedValue(apiError(404));

      const { result } = renderHook(() => useJobPolling("staff", "job-9"), {
        wrapper: stableWrapper(makeQueryClient()),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
      expect(mockFetchJob).toHaveBeenCalledTimes(1);
    });
  });

  it("stops polling and reports isError when the poll request itself fails", async () => {
    mockFetchJob.mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => useJobPolling("staff", "job-3"), { wrapper });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.isPolling).toBe(false);

    const callsAtError = mockFetchJob.mock.calls.length;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10_000);
    });
    expect(mockFetchJob.mock.calls.length).toBe(callsAtError);
  });
});
