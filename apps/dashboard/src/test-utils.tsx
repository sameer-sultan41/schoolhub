import type { AuthenticatedUser, PermissionKey } from "@schoolhub/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  render,
  renderHook,
  type RenderHookOptions,
  type RenderOptions,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useMemo, useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import messages from "../messages/en.json";

const URL_CHANGE_EVENT = "schoolhub:test-url-change";

function subscribeToUrl(onChange: () => void) {
  window.addEventListener(URL_CHANGE_EVENT, onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener(URL_CHANGE_EVENT, onChange);
    window.removeEventListener("popstate", onChange);
  };
}

function readSearch() {
  return window.location.search;
}

function readPathname() {
  return window.location.pathname;
}

function useMockSearchParams() {
  const search = useSyncExternalStore(subscribeToUrl, readSearch, readSearch);
  return useMemo(() => new URLSearchParams(search), [search]);
}

function useMockPathname() {
  return useSyncExternalStore(subscribeToUrl, readPathname, readPathname);
}

let replaceStateNotifies = false;

/**
 * An in-memory `next/navigation` for a component that reads or writes the URL. The URL is
 * jsdom's own `window.location`: `useSearchParams`/`usePathname` re-render on every
 * `window.history.replaceState`, as Next's do, and nothing else feeds them, so a hook that
 * built a write from a stale render snapshot would lose data here exactly as in a browser.
 *
 * Install it per test file: a `jest.mock("next/navigation", ...)` factory that returns
 * `createNavigationMock()` from `jest.requireActual("@/test-utils")` (see
 * `hooks/__tests__/use-url-params.test.tsx`). Start each test from a known address with
 * `setUrl`: jsdom keeps the URL from one test to the next.
 */
export function createNavigationMock() {
  if (!replaceStateNotifies) {
    const replaceState = window.history.replaceState.bind(window.history);
    window.history.replaceState = (data: unknown, unused: string, url?: string | URL | null) => {
      replaceState(data, unused, url);
      window.dispatchEvent(new Event(URL_CHANGE_EVENT));
    };
    replaceStateNotifies = true;
  }
  const router = {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
    prefetch: jest.fn(),
  };
  return {
    useSearchParams: useMockSearchParams,
    usePathname: useMockPathname,
    useRouter: () => router,
  };
}

/** Points the address bar at `url` (a path with an optional query, e.g. "/students?page=2"),
 * as a reload, a shared link or an outside navigation would. */
export function setUrl(url: string) {
  act(() => {
    window.history.replaceState(null, "", url);
  });
}

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

/** A fresh retry-disabled `QueryClient` and the provider tree (English messages) around it. */
function createClientWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale="en" messages={messages}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </NextIntlClientProvider>
    );
  }
  return { queryClient, Wrapper };
}

/**
 * `renderWithProviders`, but through a `wrapper`, so `rerender(ui)` keeps the providers, and
 * handing back the `QueryClient`: spy on its `invalidateQueries` to see what a component refreshes.
 */
export function renderWithClient(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  const { queryClient, Wrapper } = createClientWrapper();
  return { ...render(ui, { ...options, wrapper: Wrapper }), queryClient };
}

/** `renderWithClient` for a hook: the same providers, and the `QueryClient` handed back. */
export function renderHookWithClient<Result, Props>(
  callback: (props: Props) => Result,
  options?: Omit<RenderHookOptions<Props>, "wrapper">,
) {
  const { queryClient, Wrapper } = createClientWrapper();
  return { ...renderHook(callback, { ...options, wrapper: Wrapper }), queryClient };
}

/** A signed-in user holding exactly `permissions`, for a screen or menu gated by them. */
export function buildUser(permissions: PermissionKey[]): AuthenticatedUser {
  return {
    id: "user-1",
    email: "user@example.com",
    phone: null,
    full_name: "Test User",
    avatar_url: null,
    locale: "en",
    tenant_id: "tenant-1",
    roles: [],
    permissions,
  };
}

/** Watches the document for text that gets added to it, even for a single render that a
 * later render replaces — what `findByText`/`queryByText` can't see once it is gone.
 * Call `stop()` when done: it reports whether the text ever appeared. */
export function watchForAddedText(pattern: RegExp) {
  let seen = false;
  const scan = (records: MutationRecord[]) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (pattern.test(node.textContent ?? "")) seen = true;
      }
    }
  };
  const observer = new MutationObserver(scan);
  observer.observe(document.body, { childList: true, subtree: true });
  return {
    stop: () => {
      scan(observer.takeRecords());
      observer.disconnect();
      return seen;
    },
  };
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
