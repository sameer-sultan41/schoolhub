import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { Services } from "@/services";

import { useJobPolling } from "../use-job-polling";

jest.mock("@/services", () => ({
  Services: { jobs: { fetchJob: jest.fn() } },
}));

const mockFetchJob = Services.jobs.fetchJob as jest.MockedFunction<typeof Services.jobs.fetchJob>;

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
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

    // The 120s timer set on mount is still running underneath, but a job that
    // finished successfully must never be reported as timed out just because that
    // timer eventually fires.
    expect(result.current.isTimedOut).toBe(false);
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
