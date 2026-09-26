/**
 * A query's own `error` rendered as plain text — shared by every dashboard-home widget
 * (AGENTS.md's Hard Rule 4: render the API's own error, never invent a message). These
 * widgets have no field-level error mapping the way a form does, so the caught error's
 * own message is the honest, non-invented content there is to show.
 */
export function QueryErrorMessage({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return <p className="p-5 text-sm text-muted-foreground">{message}</p>;
}
