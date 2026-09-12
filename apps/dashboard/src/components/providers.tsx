"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { domAnimation, LazyMotion, MotionConfig } from "motion/react";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { setUnauthorizedHandler } from "@/lib/auth";
import { LOGIN_PATH } from "@/lib/constants";
import { getQueryClient } from "@/lib/query-client";

/**
 * Client-side providers for the whole app.
 *
 * `useState` (not a module constant) keeps one QueryClient per browser session while still
 * surviving Fast Refresh; the server gets a fresh client per request from `getQueryClient`.
 *
 * Restored (was trimmed for a while when nothing under `(auth)` needed it — see git
 * history): `LazyMotion features={domAnimation}` loads Motion's smaller animation feature
 * bundle (background/opacity/transform tweens; the bigger `domMax` bundle's gestures/layout/
 * SVG-path support isn't needed anywhere yet) lazily rather than bundling it eagerly with
 * every page. `strict` makes every consumer import `{ m }` from `"motion/react"` and use
 * `<m.div>` etc. instead of the bare `motion` component — importing `motion` directly is a
 * runtime error under `strict`, deliberately: it's the guardrail against ad-hoc animation
 * usage creeping in outside this shared, lazily-loaded feature set.
 * `MotionConfig reducedMotion="user"` respects the OS-level "reduce motion" setting for
 * every animation under this provider automatically — no per-animation opt-out needed.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(getQueryClient);
  const router = useRouter();

  useEffect(() => {
    // Fired when a refresh attempt could not rescue a 401 — the session is genuinely over.
    setUnauthorizedHandler(() => {
      queryClient.clear();
      router.replace(LOGIN_PATH);
    });
  }, [queryClient, router]);

  return (
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domAnimation} strict>
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </LazyMotion>
    </QueryClientProvider>
  );
}
