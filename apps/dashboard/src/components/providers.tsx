"use client";

import { TooltipProvider } from "@schoolhub/ui";
import { Toaster } from "@schoolhub/ui/toaster";
import { QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { setUnauthorizedHandler } from "@/lib/auth";
import { getQueryClient } from "@/lib/query-client";

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
      router.replace("/login");
    });
  }, [queryClient, router]);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{children}</TooltipProvider>
      <Toaster />
    </QueryClientProvider>
  );
}
