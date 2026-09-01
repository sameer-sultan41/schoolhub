import { useSyncExternalStore } from "react";

/**
 * shadcn/ui's own breakpoint for Sidebar's mobile/desktop split. Deliberately a local
 * constant, not a shared import from an app's own breakpoint value — this package has no
 * dependency on any app, and this is a component-internal implementation detail (which
 * viewport width switches Sidebar to its Sheet-based mobile rendering), not a design token.
 */
const MOBILE_BREAKPOINT_PX = 768;

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`);
  mql.addEventListener("change", onChange);
  return () => {
    mql.removeEventListener("change", onChange);
  };
}

function getSnapshot(): boolean {
  return window.innerWidth < MOBILE_BREAKPOINT_PX;
}

/** True below shadcn's mobile breakpoint. `false` on the server and until the first
 * client-side measurement, so SSR never guesses a viewport width it doesn't have —
 * `useSyncExternalStore` (not an effect + setState) is what makes that guess-free instead
 * of racing a render against a subscription. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
