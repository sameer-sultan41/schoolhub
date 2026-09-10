/**
 * Every API endpoint path the dashboard calls, grouped by domain.
 *
 * A path is either a static string, or — when it needs a value only known at call time
 * (an id, a slug) — a function returning one, e.g. `students: { detail: (id: string) =>
 * `/students/${id}` }`. A component never reads this file directly and never hardcodes a
 * path string of its own: it calls `Services.<domain>.<action>(...)` (see
 * `src/services/index.ts`), and that domain's own `services/modules/<domain>/` file is the
 * one place that reads `endpoints.<domain>.*`. The one exception is `src/lib/auth.ts`'s own
 * client wiring (the transport layer's internal refresh-retry, which runs before any
 * service function does) — infrastructure, not a module's API call, but it still reads its
 * one path from here rather than hardcoding it.
 *
 * Add a new domain the moment a real module needs one — this file has exactly the paths
 * this app actually calls today, nothing speculative.
 */
export const endpoints = {
  auth: {
    login: "/login",
    logout: "/logout",
    me: "/auth/me",
    refresh: "/refresh",
  },
} as const;
