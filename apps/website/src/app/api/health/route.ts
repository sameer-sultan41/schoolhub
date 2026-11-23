/**
 * Liveness for the load balancer's health check: is the process up and serving?
 *
 * No I/O, and imports neither `@/lib/env` nor `@/lib/api`, so an API outage never takes every
 * renderer task out of rotation. A config error does fail it, on purpose: the proxy imports
 * `env.ts`, which throws on invalid configuration, so a misconfigured task never turns healthy.
 * The proxy lets it through on any host (`HOST_INDEPENDENT_PATHS`), the ALB's task IP included.
 */
export function GET(): Response {
  return Response.json({ status: "ok" });
}
