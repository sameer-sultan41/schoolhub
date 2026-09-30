/**
 * Global Zustand stores live here, one file per concern (e.g. `ui-store.ts`), built with
 * zustand's `create()` — this app's documented "minimal client state" tool
 * (apps/dashboard/AGENTS.md). Nothing lives here yet.
 *
 * If a future store needs its initial value seeded from the server per request (the way
 * preferences do), follow `src/lib/preferences/preferences-store.ts`'s pattern instead:
 * `zustand/vanilla` + a Context provider in `src/providers/`, not this plain-`create()` one.
 */
export {};
