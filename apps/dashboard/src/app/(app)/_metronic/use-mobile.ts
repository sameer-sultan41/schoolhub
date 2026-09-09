import { useSyncExternalStore } from "react";

// Local copy of @schoolhub/ui's hooks/use-mobile.ts. That file is only reachable
// through the package's untyped wildcard export ("./*": "./src/*", a bare string
// with no types condition), which Next's build-time typecheck can't resolve —
// see this route's own notes. Duplicated here rather than editing packages/ui,
// which this preview leaves untouched.
const MOBILE_BREAKPOINT_PX = 768;

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`);
  mql.addEventListener("change", onChange);
  return () => {
    mql.removeEventListener("change", onChange);
  };
}

function getSnapshot(): boolean {
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`).matches;
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
