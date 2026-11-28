/**
 * RED stub (Task 9 fix round 1): today's check, `startsWith("/")`, which lets `//host` through.
 * The implementation lands after the RED run.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  return next?.startsWith("/") ? next : null;
}
