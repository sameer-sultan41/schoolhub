import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";

/**
 * Shared render wrapper: a retry-disabled QueryClient, since every widget on this
 * preview route fetches through TanStack Query. No `NextIntlClientProvider` — this
 * preview has no i18n wiring yet (see teams.tsx's own comment).
 */
export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>, options);
}
