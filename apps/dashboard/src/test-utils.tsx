import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import messages from "../messages/en.json";

/** Shared render wrapper: a retry-disabled QueryClient plus English messages for next-intl. */
export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>,
    options,
  );
}

/** jest.setup.ts defaults `window.matchMedia` to `matches: false` (desktop) — a test
 * exercising a `useIsMobile()`-driven mobile branch (a `ResponsiveDialog`/
 * `ResponsiveSheet` rendering its `Drawer` instead of `Dialog`/`Sheet`) overrides it
 * with this for the duration of that test, then calls it again with `false` in
 * `afterEach` to avoid leaking the override into later tests in the same file. */
export function setMatchesMobile(matches: boolean) {
  (window.matchMedia as jest.Mock).mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
}
