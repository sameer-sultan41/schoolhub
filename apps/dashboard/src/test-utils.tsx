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
 * Shared render wrapper: real English messages, a retry-disabled QueryClient, and the
 * motion providers `components/providers.tsx` mounts in production — a component tested
 * under a different provider tree is not the component that ships.
 *
 * `reducedMotion="always"` is a deliberate difference from production: animations settle
 * immediately, so assertions never race a transition, and every test exercises the
 * reduced-motion branch — the branch most likely to be written once and never looked at
 * again.
 *
 * `ThemeProvider` is NOT here; see `renderWithTheme` below for why.
 */
export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale="en" messages={messages} now={new Date("2026-01-01")}>
        <MotionConfig reducedMotion="always">
          {/* `strict` makes importing the full `motion` component a runtime error, so a
              screen that reaches for it instead of `m` fails here rather than shipping
              the 34kb bundle it was meant to avoid. */}
          <LazyMotion features={domAnimation} strict>
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
          </LazyMotion>
        </MotionConfig>
      </NextIntlClientProvider>
    );
  }

  return { queryClient, ...render(ui, { wrapper: Wrapper, ...options }) };
}

/**
 * `renderWithProviders` plus next-themes, for the handful of components that actually
 * call `useTheme()`.
 *
 * Opt-in rather than part of the default wrapper because `ThemeProvider` renders an
 * inline `<script>` — the one that sets the theme class before hydration and prevents a
 * flash of the wrong theme. In a real page that script is invisible and load-bearing; in
 * a test it lands inside RTL's `container` and makes it non-empty, which quietly breaks
 * every `toBeEmptyDOMElement()` assertion in the suite. Those assertions are worth more
 * than blanket theme context: nothing but the toggle and the toaster reads the theme in
 * JS at all — every other component reads CSS custom properties, which jsdom does not
 * resolve either way.
 *
 * `defaultTheme="light"` rather than production's "system" so the resolved theme does not
 * depend on the stubbed `matchMedia`.
 */
export function renderWithTheme(ui: ReactElement, options?: RenderOptions) {
  return renderWithProviders(
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      {ui}
    </ThemeProvider>,
    options,
  );
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
