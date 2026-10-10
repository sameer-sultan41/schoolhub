import { ApiError } from "@schoolhub/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { Services } from "@/services";
import type { BackgroundJobRecord, JobStatus } from "@/services/modules/jobs/jobs-service";

import enMessages from "../../../messages/en.json";
import { useJobFileDownload, type JobFileDownloadMessages } from "../use-job-file-download";

jest.mock("@/services", () => ({
  Services: { jobs: { fetchJob: jest.fn(), fetchFileDownloadUrl: jest.fn() } },
}));

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

const mockFetchJob = Services.jobs.fetchJob as jest.MockedFunction<typeof Services.jobs.fetchJob>;
const mockFetchFileDownloadUrl = Services.jobs.fetchFileDownloadUrl as jest.MockedFunction<
  typeof Services.jobs.fetchFileDownloadUrl
>;
const mockToastError = toast.error as jest.MockedFunction<typeof toast.error>;
const mockToastSuccess = toast.success as jest.MockedFunction<typeof toast.success>;

const MESSAGES: JobFileDownloadMessages = {
  startFailed: "Could not start.",
  downloadFailed: "Could not download.",
  timedOut: "Taking too long.",
  failed: "The job failed.",
  success: (result) => `Done: ${Number(result?.count)}`,
};

/** What a locale switch hands the hook: a new `messages` object whose strings and `success`
 * identity both differ from `MESSAGES`. */
const CHANGED_MESSAGES: JobFileDownloadMessages = {
  ...MESSAGES,
  failed: "The job failed (changed).",
  success: () => "Done (changed).",
};

function jobRecord(
  id: string,
  status: JobStatus,
  extra: Partial<BackgroundJobRecord> = {},
): BackgroundJobRecord {
  return {
    id,
    job_type: "export.students",
    status,
    progress: status === "succeeded" ? 100 : 0,
    result: null,
    error: null,
    ...extra,
  };
}

function succeededJob(id: string, fileId: string, extra: Record<string, unknown> = {}) {
  return jobRecord(id, "succeeded", { result: { result_file_id: fileId, ...extra } });
}

function startReturning(jobId: string) {
  return jest.fn<Promise<{ jobId: string }>, []>().mockResolvedValue({ jobId });
}

/** One client per test, created outside the wrapper — a client built inside it would be
 * replaced on every `rerender` and hide exactly the cache reuse these tests rely on. */
function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </NextIntlClientProvider>
    );
  };
}

function renderDownload<TArgs = void>(start: (args: TArgs) => Promise<{ jobId: string }>) {
  return renderHook(
    ({ hookMessages }: { hookMessages: JobFileDownloadMessages }) =>
      useJobFileDownload<TArgs>({
        module: "students",
        start,
        filename: "export.csv",
        messages: hookMessages,
      }),
    { wrapper: makeWrapper(), initialProps: { hookMessages: MESSAGES } },
  );
}

function spyOnAnchorClick() {
  return jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
}

describe("useJobFileDownload", () => {
  let clickSpy: ReturnType<typeof spyOnAnchorClick>;

  beforeEach(() => {
    jest.useFakeTimers({ advanceTimers: true });
    mockFetchJob.mockReset();
    mockFetchFileDownloadUrl.mockReset();
    mockToastError.mockReset();
    mockToastSuccess.mockReset();
    clickSpy = spyOnAnchorClick();
  });

  afterEach(() => {
    clickSpy.mockRestore();
    jest.useRealTimers();
  });

  it("downloads the result file once and toasts success(result)", async () => {
    mockFetchJob
      .mockResolvedValueOnce(jobRecord("job-1", "running", { progress: 10 }))
      .mockResolvedValue(succeededJob("job-1", "f1", { count: 3 }));
    mockFetchFileDownloadUrl.mockResolvedValue("https://storage.test/f1");
    const { result, rerender } = renderDownload(startReturning("job-1"));

    act(() => {
      result.current.run();
    });
    // The first poll has landed — the next one is the 2s interval away.
    await waitFor(() => {
      expect(result.current.progress).toBe(10);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith("Done: 3");
    });
    const anchor = clickSpy.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.href).toBe("https://storage.test/f1");
    expect(anchor.download).toBe("export.csv");

    // New messages after the job succeeded re-run the effect; the job is already handled.
    rerender({ hookMessages: CHANGED_MESSAGES });
    rerender({ hookMessages: MESSAGES });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10_000);
    });
    expect(mockFetchFileDownloadUrl).toHaveBeenCalledTimes(1);
    expect(mockFetchFileDownloadUrl).toHaveBeenCalledWith("f1");
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
  });

  it("never downloads the same job twice, even when a re-render changes the messages", async () => {
    mockFetchJob.mockResolvedValue(succeededJob("job-2", "f2"));
    mockFetchFileDownloadUrl.mockResolvedValue("https://storage.test/f2");
    const { result, rerender } = renderDownload(startReturning("job-2"));

    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalledTimes(1);
    });

    // A locale switch hands the hook new strings: the effect re-runs, but the job is handled.
    rerender({ hookMessages: CHANGED_MESSAGES });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(mockFetchFileDownloadUrl).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("run() resumes a stalled job instead of starting another", async () => {
    mockFetchJob.mockResolvedValue(jobRecord("job-3", "running"));
    mockFetchFileDownloadUrl.mockResolvedValue("https://storage.test/f3");
    const start = startReturning("job-3");
    const { result } = renderDownload(start);

    act(() => {
      result.current.run();
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
    expect(result.current.isBusy).toBe(false);
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(MESSAGES.timedOut);
    });
    const callsAtStall = mockFetchJob.mock.calls.length;

    // The job finishes server-side while nobody is watching it.
    mockFetchJob.mockResolvedValue(succeededJob("job-3", "f3"));
    act(() => {
      result.current.run();
    });

    await waitFor(() => {
      expect(mockFetchFileDownloadUrl).toHaveBeenCalledWith("f3");
    });
    expect(mockFetchJob.mock.calls.length).toBeGreaterThan(callsAtStall);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("treats a failed poll as stalled too: toasts failed, then run() re-checks the same job", async () => {
    mockFetchJob
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValue(jobRecord("job-4", "running"));
    const start = startReturning("job-4");
    const { result } = renderDownload(start);

    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(result.current.isStalled).toBe(true);
    });
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(MESSAGES.failed);
    });

    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(result.current.isBusy).toBe(true);
    });
    expect(result.current.isStalled).toBe(false);
    expect(start).toHaveBeenCalledTimes(1);
    expect(mockFetchJob.mock.calls.length).toBeGreaterThan(1);
  });

  it("toasts job.error once when the job fails, even if a re-render changes the messages", async () => {
    mockFetchJob.mockResolvedValue(
      jobRecord("job-5", "failed", { error: "Storage backend unavailable." }),
    );
    const { result, rerender } = renderDownload(startReturning("job-5"));

    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("Storage backend unavailable.");
    });

    rerender({ hookMessages: CHANGED_MESSAGES });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockFetchFileDownloadUrl).not.toHaveBeenCalled();
    expect(result.current.isBusy).toBe(false);
  });

  it("falls back to messages.failed when a failed job carries no error", async () => {
    mockFetchJob.mockResolvedValue(jobRecord("job-6", "failed"));
    const { result } = renderDownload(startReturning("job-6"));

    act(() => {
      result.current.run();
    });

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(MESSAGES.failed);
    });
  });

  it("toasts messages.startFailed when start rejects with a non-API error", async () => {
    const start = jest.fn<Promise<{ jobId: string }>, []>().mockRejectedValue(new Error("boom"));
    const { result } = renderDownload(start);

    act(() => {
      result.current.run();
    });

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(MESSAGES.startFailed);
    });
    expect(mockFetchJob).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(result.current.isBusy).toBe(false);
    });
  });

  it("toasts the translated API error when start rejects with an ApiError", async () => {
    const apiError = new ApiError({
      code: "permission_denied",
      message: "You don't have permission to do that.",
      status: 403,
      url: "/students-exports",
    });
    const start = jest.fn<Promise<{ jobId: string }>, []>().mockRejectedValue(apiError);
    const { result } = renderDownload(start);

    act(() => {
      result.current.run();
    });

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(enMessages.errors.permission_denied);
    });
  });

  it("toasts messages.downloadFailed and frees the caller when the download URL cannot be fetched", async () => {
    mockFetchJob.mockResolvedValue(succeededJob("job-8", "f8"));
    mockFetchFileDownloadUrl.mockRejectedValue(new Error("storage unavailable"));
    const { result } = renderDownload(startReturning("job-8"));

    act(() => {
      result.current.run();
    });

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(MESSAGES.downloadFailed);
    });
    expect(clickSpy).not.toHaveBeenCalled();
    expect(mockToastSuccess).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(result.current.isBusy).toBe(false);
    });
  });

  it("stays busy between the job succeeding and the download URL resolving", async () => {
    mockFetchJob.mockResolvedValue(succeededJob("job-11", "f11"));
    let resolveUrl: (url: string) => void = () => {};
    mockFetchFileDownloadUrl.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveUrl = resolve;
      }),
    );
    const { result } = renderDownload(startReturning("job-11"));

    act(() => {
      result.current.run();
    });
    // Progress 100 means the succeeded record has landed, so the job itself no longer
    // counts as active — only the pending download can keep the caller busy now.
    await waitFor(() => {
      expect(result.current.progress).toBe(100);
    });
    await waitFor(() => {
      expect(mockFetchFileDownloadUrl).toHaveBeenCalledWith("f11");
    });
    await waitFor(() => {
      expect(result.current.isBusy).toBe(true);
    });

    // Not wrapped in `act`: the resulting updates land while `waitFor` polls, which
    // is already outside React's act environment.
    resolveUrl("https://storage.test/f11");

    await waitFor(() => {
      expect(result.current.isBusy).toBe(false);
    });
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("reports the polled job's progress while it runs", async () => {
    mockFetchJob.mockResolvedValue(jobRecord("job-12", "running", { progress: 40 }));
    const { result } = renderDownload(startReturning("job-12"));
    expect(result.current.progress).toBe(0);

    act(() => {
      result.current.run();
    });

    await waitFor(() => {
      expect(result.current.progress).toBe(40);
    });
    expect(result.current.isBusy).toBe(true);
    expect(result.current.isStalled).toBe(false);
  });

  it("passes run's argument through to start, and nothing else", async () => {
    mockFetchJob.mockResolvedValue(jobRecord("job-13", "running"));
    const start = jest
      .fn<Promise<{ jobId: string }>, [{ studentIds: string[] }]>()
      .mockResolvedValue({ jobId: "job-13" });
    const { result } = renderDownload(start);

    act(() => {
      result.current.run({ studentIds: ["s1", "s2"] });
    });

    await waitFor(() => {
      expect(start).toHaveBeenCalledTimes(1);
    });
    // Exactly one argument: TanStack's own mutation context must not leak into `start`.
    expect(start.mock.calls[0]).toEqual([{ studentIds: ["s1", "s2"] }]);
  });
});
