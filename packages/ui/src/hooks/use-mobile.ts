"use client";

import { useMediaQuery } from "./use-media-query";

/**
 * shadcn/ui's own breakpoint for Sidebar's mobile/desktop split. Deliberately a local
 * constant, not a shared import from an app's own breakpoint value — this package has no
 * dependency on any app, and this is a component-internal implementation detail (which
 * viewport width switches Sidebar to its Sheet-based mobile rendering), not a design token.
 */
const MOBILE_BREAKPOINT_PX = 768;

/** True below shadcn's mobile breakpoint. `false` on the server and until the first
 * client-side measurement, so SSR never guesses a viewport width it doesn't have. */
export function useIsMobile(): boolean {
  // Not window.innerWidth: a scrollbar's own width is included in some browsers' layout
  // viewport but not others', so it and matchMedia's own boundary can disagree by exactly
  // that many pixels right at the breakpoint. matchMedia is the one definition of "mobile"
  // both the subscription and the read agree on.
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`, false);
}
