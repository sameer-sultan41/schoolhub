export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export interface JobRecord {
  id: string;
  job_type: string;
  status: JobStatus;
  progress: number;
  result: Record<string, unknown> | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ImportRowError {
  row: string;
  field: string;
  issue: string;
}

export interface ImportResult {
  total: number;
  succeeded: number;
  failed: number;
  errors: ImportRowError[];
}
