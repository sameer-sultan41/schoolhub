import type { ApiClient } from "@schoolhub/api-client";
import { expect } from "@/fixtures";

/** A row of `GET /jobs/{id}` — see `core/jobs/models.py::BackgroundJob`. */
export interface BackgroundJob<TResult = unknown> {
  id: string;
  job_type: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number;
  result: TResult | null;
  error: string | null;
}

const TERMINAL = new Set(["succeeded", "failed"]);

/**
 * Poll `GET /jobs/{id}` until it reaches a terminal status, then return it.
 *
 * The live lane needs this because a `202` endpoint's response body carries a job
 * id and nothing else — the thing worth asserting on happens in a Celery worker
 * afterwards. Without polling, a spec either asserts the queueing and stops
 * short of the behaviour, or races the worker and flakes.
 *
 * Fails the test on timeout rather than returning a non-terminal job, so a
 * caller never has to distinguish "still running" from "finished" — if this
 * returns, the work is over. A stuck worker should look like a failure here,
 * not like an assertion error three lines later against a null `result`.
 */
export async function awaitJob<TResult>(
  liveApiClient: ApiClient,
  jobId: string,
  { timeoutMs = 30_000, intervalMs = 500 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<BackgroundJob<TResult>> {
  const deadline = Date.now() + timeoutMs;
  let last: BackgroundJob<TResult> | undefined;

  while (Date.now() < deadline) {
    const { data } = await liveApiClient.get<BackgroundJob<TResult>>(`/jobs/${jobId}`);
    last = data;
    if (TERMINAL.has(data.status)) return data;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  expect(
    last?.status,
    `job ${jobId} never reached a terminal status within ${timeoutMs}ms ` +
      `(last seen: ${last?.status ?? "never fetched"}, progress ${last?.progress ?? 0})`,
  ).toBe("succeeded");
  throw new Error("unreachable — the expect above always throws");
}

/** `awaitJob`, asserting the job succeeded and returning its result payload. */
export async function awaitJobResult<TResult>(
  liveApiClient: ApiClient,
  jobId: string,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<TResult> {
  const job = await awaitJob<TResult>(liveApiClient, jobId, options);
  expect(job.status, `job ${job.id} failed: ${job.error ?? "no error recorded"}`).toBe("succeeded");
  expect(job.result).not.toBeNull();
  return job.result as TResult;
}
