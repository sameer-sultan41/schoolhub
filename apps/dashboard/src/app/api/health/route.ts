/**
 * Liveness for the load balancer's health check: is the process up and serving?
 *
 * No I/O and no env import, so an API outage never takes every dashboard task out of rotation.
 * The proxy's matcher already skips `api/`, so the ALB's probe by task IP reaches it.
 */
export function GET(): Response {
  return Response.json({ status: "ok" });
}
