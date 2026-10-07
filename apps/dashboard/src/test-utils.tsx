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

/** Answers one `matchMedia` query against a single simulated viewport width, so a
 * min-width query (`useIsDesktopShell`, 1024px) and a max-width query (`useIsMobile`,
 * 768px) agree on the same "which breakpoint band is this" answer instead of both
 * blindly returning one blanket boolean regardless of which direction they actually
 * ask — the two mean opposite things for the same boolean once both kinds of query
 * exist. Shared with `jest.setup.ts`'s default mock so both use the same logic. */
export function matchesForWidth(query: string, width: number): boolean {
  const min = /\(min-width:\s*([\d.]+)px\)/.exec(query);
  if (min) return width >= Number(min[1]);
  const max = /\(max-width:\s*([\d.]+)px\)/.exec(query);
  if (max) return width <= Number(max[1]);
  return false;
}

/** jest.setup.ts defaults `window.matchMedia` to a simulated 1280px (desktop) — a test
 * exercising a mobile branch (a `ResponsiveDialog`/`ResponsiveSheet` rendering its
 * `Drawer` instead of `Dialog`/`Sheet`) overrides it with this (simulating 375px) for
 * the duration of that test, then calls it again with `false` in `afterEach` to avoid
 * leaking the override into later tests in the same file. */
export function setMatchesMobile(matches: boolean) {
  const width = matches ? 375 : 1280;
  (window.matchMedia as jest.Mock).mockImplementation((query: string) => ({
    matches: matchesForWidth(query, width),
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
}

/** jsdom has no object URLs; a picked file's local preview needs one. */
export function stubObjectUrls(url: string) {
  const saved = ["createObjectURL", "revokeObjectURL"].map(
    (name) => [name, Object.getOwnPropertyDescriptor(URL, name)] as const,
  );
  Object.defineProperty(URL, "createObjectURL", { value: jest.fn(() => url), configurable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: jest.fn(), configurable: true });
  return () => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(URL, name, descriptor);
      else Reflect.deleteProperty(URL, name);
    }
  };
}

/** jsdom never loads images, so Radix's `AvatarImage` would wait forever without this. */
export function stubImageLoading() {
  const complete = jest.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
  const width = jest.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(1);
  return () => {
    complete.mockRestore();
    width.mockRestore();
  };
}
