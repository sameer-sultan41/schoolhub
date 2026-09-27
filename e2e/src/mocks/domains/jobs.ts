import { fail, ok } from "../envelope";
import type { MockModule } from "../router";

export interface JobStub {
  status: "queued" | "running" | "succeeded" | "failed";
  progress?: number;
  result?: Record<string, unknown> | null;
  error?: string | null;
}

export interface FileDownloadStub {
  id: string;
  downloadUrl: string;
}

export interface JobsOptions {
  /** Each job's poll sequence — one entry consumed per `GET /jobs/{id}`, the last
   * entry repeating once exhausted, so a spec can simulate "queued, then running,
   * then succeeded" with exactly the polls it wants to assert on. */
  jobs?: Record<string, JobStub[]>;
  files?: FileDownloadStub[];
}

function toJobRecord(id: string, stub: JobStub) {
  return {
    id,
    job_type: "test.job",
    status: stub.status,
    progress: stub.progress ?? 0,
    result: stub.result ?? null,
    error: stub.error ?? null,
  };
}

/** `GET /jobs/{id}` and `POST /files/{id}:download` — core platform infra
 * (`core.jobs`, `core.files`), reusable by any module's background-job flow. Mirrors
 * `staffModule`'s shape. */
export function jobsModule(options: JobsOptions = {}): MockModule {
  return (api) => {
    const jobs = options.jobs ?? {};
    const files = options.files ?? [];
    const pollCounts: Record<string, number> = {};

    api.get("/jobs/:jobId", (request) => {
      const jobId = request.params["jobId"] ?? "";
      const sequence = jobs[jobId];
      if (!sequence || sequence.length === 0) return fail(404, "Job not found.");
      const index = pollCounts[jobId] ?? 0;
      const stub = sequence[Math.min(index, sequence.length - 1)] as JobStub;
      pollCounts[jobId] = index + 1;
      return ok(toJobRecord(jobId, stub));
    });

    // `POST /files/{id}:download` is a colon-action — same split as
    // staffModule's `/staff/{id}:exit` handling. `action` genuinely can only be
    // "download" here — `:confirm` is a different, unrelated route registered by a
    // future files-domain module, not this one, and 404s correctly falling through
    // this handler if it's ever hit is the point.
    api.post("/files/:fileAction", (request) => {
      const [fileId, action] = (request.params["fileAction"] ?? "").split(":");
      const file = files.find((candidate) => candidate.id === fileId);
      if (action !== "download" || !file) return fail(404, "Not found.");
      return ok({ download_url: file.downloadUrl });
    });
  };
}
