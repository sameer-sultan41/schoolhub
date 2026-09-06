import type { ApiResult } from "@schoolhub/api-client";
import type { AuthenticatedUser } from "@schoolhub/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import { NextIntlClientProvider } from "next-intl";
import { ThemeProvider } from "next-themes";
import type { ReactElement, ReactNode } from "react";
import messages from "../messages/en.json";

/**
 * Shared render wrapper: real English messages, a retry-disabled QueryClient, and the same
 * theme and motion providers `components/providers.tsx` mounts in production — a component
 * tested under a different provider tree is not the component that ships.
 *
 * Two deliberate differences from production:
 *  - `defaultTheme="light"`. Production defaults to "system", which in jsdom resolves
 *    through the stubbed `matchMedia` (always `matches: false`); pinning it removes a
 *    dependency on that stub from every test that renders anything themed.
 *  - `reducedMotion="always"`. Animations settle immediately, so assertions never race a
 *    transition. It also means every test exercises the reduced-motion branch, which is
 *    the branch most likely to be written and never looked at again.
 */
export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale="en" messages={messages} now={new Date("2026-01-01")}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
          <MotionConfig reducedMotion="always">
            {/* `strict` makes importing the full `motion` component a runtime error, so a
                screen that reaches for it instead of `m` fails here rather than shipping
                the 34kb bundle it was meant to avoid. */}
            <LazyMotion features={domAnimation} strict>
              <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
            </LazyMotion>
          </MotionConfig>
        </ThemeProvider>
      </NextIntlClientProvider>
    );
  }

  return { queryClient, ...render(ui, { wrapper: Wrapper, ...options }) };
}

/**
 * next-themes persists to localStorage and writes a class onto <html>, and jest's
 * `clearMocks` resets neither — a test that switches to dark would otherwise decide the
 * theme for every test that runs after it. Call this in an `afterEach` from any suite that
 * changes the theme.
 */
export function resetTheme(): void {
  window.localStorage.removeItem("theme");
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.style.removeProperty("color-scheme");
}

/** Wraps `data` in the same envelope shape `apiClient`'s methods resolve to. */
export function apiResult<T>(data: T): ApiResult<T> {
  return { data, meta: undefined, requestId: null, status: 200 };
}

export function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: "u1",
    email: "admin@cityschool.test",
    phone: null,
    full_name: "Ayesha Khan",
    avatar_url: null,
    locale: "en",
    tenant_id: "t1",
    roles: [],
    permissions: [],
    ...overrides,
  };
}
