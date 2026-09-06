"use client";

import { TooltipProvider } from "@schoolhub/ui";
import { Toaster } from "@schoolhub/ui/toaster";
import { QueryClientProvider } from "@tanstack/react-query";
import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import { ThemeProvider, useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { setUnauthorizedHandler } from "@/lib/auth";
import { LOGIN_PATH } from "@/lib/constants";
import { getQueryClient } from "@/lib/query-client";

/**
 * sonner listens to the OS preference itself, which was correct while that was the only
 * mechanism. Now that a toggle exists, the toaster has to follow the same resolved theme
 * as everything else or a viewer who chose light on a dark-mode machine gets one dark
 * panel floating over a light app. `resolvedTheme` is undefined until mount, and "system"
 * is the honest answer for that moment.
 */
function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" || resolvedTheme === "light" ? resolvedTheme : "system";
  return <Toaster theme={theme} />;
}

/**
 * Client-side providers for the whole app.
 *
 * `useState` (not a module constant) keeps one QueryClient per browser session while still
 * surviving Fast Refresh; the server gets a fresh client per request from `getQueryClient`.
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
    // attribute="class" matches the `dark` variant packages/ui/src/styles/theme.css
    // defines. enableSystem keeps "match the OS" as the default, so a viewer who never
    // touches the toggle gets exactly the behaviour they had before it existed — the
    // toggle adds a choice, it does not take the default away.
    // disableTransitionOnChange stops every colour-transitioning element in the tree from
    // animating at once when the theme flips, which reads as a page-wide flash rather
    // than as a setting being applied.
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <MotionConfig reducedMotion="user">
        {/* LazyMotion + `m` keeps motion at ~5kb instead of the full component's ~34kb.
            `strict` turns reaching for `motion` instead of `m` into a runtime error, so
            the saving cannot be undone by accident in a later screen. */}
        <LazyMotion features={domAnimation} strict>
          <QueryClientProvider client={queryClient}>
            <TooltipProvider>{children}</TooltipProvider>
            <ThemedToaster />
          </QueryClientProvider>
        </LazyMotion>
      </MotionConfig>
    </ThemeProvider>
  );
}
