/** Whether `pathname` is `path` or sits under it, on a segment boundary (`/exams` is not `/exams-archive`).
 * The root `/` matches only itself. */
export function matchesPath(path: string, pathname: string): boolean {
  return pathname === path || (path.length > 1 && pathname.startsWith(`${path}/`));
}

/** The longest of `paths` that matches `pathname`, so a path nested under another's
 * (`/exams/grading-scales` under `/exams`) wins instead of lighting up both. */
export function mostSpecificPath(paths: readonly string[], pathname: string): string | undefined {
  return paths
    .filter((path) => matchesPath(path, pathname))
    .reduce<string | undefined>(
      (best, path) => (best === undefined || path.length > best.length ? path : best),
      undefined,
    );
}
