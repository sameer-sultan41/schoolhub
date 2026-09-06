import type { ApiResult } from "@schoolhub/api-client";
import type { AuthenticatedUser, CursorPagination, OffsetPagination } from "@schoolhub/types";
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

/**
 * Pagination envelopes for tests.
 *
 * Every table test used to spell `meta: { pagination: { next_cursor: null,
 * previous_cursor: null, page_size: 25 } }` out by hand, once per mocked response —
 * dozens of literals across eight files, all describing a shape none of those endpoints
 * returns any more. Moving admin lists to page numbers meant editing every one of them,
 * which is the argument for this file: the shape is written once, and the next change to
 * it is one edit rather than a search.
 *
 * The two builders are separate rather than one with a mode, because a test asserting
 * page-number behaviour against a cursor envelope is a test that cannot fail for the
 * right reason. Picking the wrong builder is a type error at the call site instead.
 */

interface Envelope<TItem, TPagination> {
  data: TItem[];
  meta: { pagination: TPagination };
  requestId: string;
  status: number;
}

/**
 * A page-number response — what every admin list returns now.
 *
 * `total_count` and `total_pages` default to describing a single complete page of the
 * items given, which is what most tests want and none of them should have to state.
 * Override them to test a pager that has somewhere to go.
 */
export function offsetPage<TItem>(
  items: TItem[],
  overrides: Partial<OffsetPagination> = {},
  requestId = "req-test",
): Envelope<TItem, OffsetPagination> {
  const pageSize = overrides.page_size ?? 25;
  const totalCount = overrides.total_count ?? items.length;
  return {
    data: items,
    meta: {
      pagination: {
        page: 1,
        page_size: pageSize,
        total_count: totalCount,
        total_pages: Math.max(1, Math.ceil(totalCount / pageSize)),
        ...overrides,
      },
    },
    requestId,
    status: 200,
  };
}

/**
 * A cursor response — for the endpoints that kept one (academic sessions, guardians,
 * timetable slots, documents, transfers).
 *
 * `total_count` is deliberately absent unless asked for: on a cursor endpoint it is
 * opt-in server-side, and a fixture that always supplied one would let a component
 * depending on it pass here and fail against the real API.
 */
export function cursorPage<TItem>(
  items: TItem[],
  overrides: Partial<CursorPagination> = {},
  requestId = "req-test",
): Envelope<TItem, CursorPagination> {
  return {
    data: items,
    meta: {
      pagination: {
        next_cursor: null,
        previous_cursor: null,
        page_size: 25,
        ...overrides,
      },
    },
    requestId,
    status: 200,
  };
}
