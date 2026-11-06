import { ApiError } from "@schoolhub/api-client";

/**
 * One refused row of a whole-grid submission (`error.meta.rows[]`): the student and the server's
 * own sentence. `field` names the refused cell where the server says (marks' `:bulk-entry`);
 * attendance's `:bulk-mark` sends none.
 */
export interface RowIssue {
  student_id: string;
  issue: string;
  field?: string;
}

function isRowIssue(value: unknown): value is RowIssue {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.student_id === "string" &&
    typeof row.issue === "string" &&
    (row.field === undefined || typeof row.field === "string")
  );
}

/**
 * A refused grid's per-student issues (student id -> the row as the server sent it), from
 * `error.meta.rows` (never `details`, which the server flattens). Empty for any other error.
 * When a student is listed twice the first issue wins.
 */
export function rowIssueRecordsFromError(error: unknown): Map<string, RowIssue> {
  const issues = new Map<string, RowIssue>();
  if (!(error instanceof ApiError)) return issues;
  const rows = error.meta.rows;
  if (!Array.isArray(rows)) return issues;
  for (const row of rows) {
    if (isRowIssue(row) && !issues.has(row.student_id)) issues.set(row.student_id, row);
  }
  return issues;
}

/** `rowIssueRecordsFromError`, as student id -> the server's sentence. */
export function rowIssuesFromError(error: unknown): Map<string, string> {
  const records = rowIssueRecordsFromError(error);
  return new Map([...records].map(([studentId, row]) => [studentId, row.issue]));
}
