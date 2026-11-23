/**
 * Liveness for the load balancer's health check: is the process up and serving?
 *
 * No I/O, and imports neither `@/lib/env` nor `@/lib/api`, so an API outage or a config error
 * never takes every renderer task out of rotation. The proxy lets it through on any host
 * (`HOST_INDEPENDENT_PATHS`), including the task IP the ALB probes.
 */
export function GET(): Response {
  return Response.json({ status: "ok" });
}
