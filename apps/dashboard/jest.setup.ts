import "@testing-library/jest-dom";

import { matchesForWidth } from "./src/test-utils";

// next-intl reads these in components under test; the real values come from the tenant.
process.env.NEXT_PUBLIC_API_BASE_URL ??= "https://api.test.invalid/api/v1";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
// Required by lib/env.ts's schema; only set in .env.local (gitignored, and Next skips
// .env.local under NODE_ENV=test anyway), so every test run needs its own default.
process.env.NEXT_PUBLIC_PLATFORM_DOMAIN ??= "schoolhub.test";

// Guarded throughout: this setup file runs for EVERY test file regardless of its own
// testEnvironment, and a file using `@jest-environment node` (proxy/route-handler tests
// needing the real Request/Response globals) has no `window` at all — referencing it
// unconditionally crashes those files.
if (typeof window !== "undefined") {
  // jsdom has no matchMedia implementation; @schoolhub/ui's Sidebar (via use-mobile,
  // 768px max-width) and use-is-desktop-shell (1024px min-width) both call it
  // unconditionally on mount. A blanket `matches: false` for every query was correct
  // when only one direction of query existed, but a min-width query and a max-width
  // query mean opposite things for the same boolean — `matchesForWidth` answers each
  // query against one simulated viewport instead, so both hooks agree on the same
  // "which breakpoint band is this" default. 1280px here (desktop) — tests that need
  // the mobile branch override this for that one call (see test-utils.tsx's
  // setMatchesMobile, which uses the same width-matching logic against 375px).
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: matchesForWidth(query, 1280),
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });

  // jsdom implements neither the Pointer Events capture API nor scrollIntoView.
  // Radix's Select (and other primitives built on @radix-ui/react-use-pointer-*)
  // call element.hasPointerCapture/scrollIntoView unconditionally on open/select,
  // so any test that interacts with one throws "target.hasPointerCapture is not
  // a function" without these. Documented jsdom gap, not a real assertion to make.
  window.HTMLElement.prototype.hasPointerCapture ??= () => false;
  window.HTMLElement.prototype.setPointerCapture ??= () => undefined;
  window.HTMLElement.prototype.releasePointerCapture ??= () => undefined;
  window.HTMLElement.prototype.scrollIntoView ??= () => undefined;

  // Recharts sizes every chart from ResizeObserver plus getBoundingClientRect, and jsdom
  // has neither (the first is absent, the second always returns zeroes). A chart in a
  // zero-size container renders no marks at all, so without these a chart test fails for
  // a reason that has nothing to do with the chart. This is a jsdom gap, not an assertion.
  globalThis.ResizeObserver ??= class {
    observe() {
      // No layout in jsdom, so nothing to report.
    }
    unobserve() {
      // See observe().
    }
    disconnect() {
      // See observe().
    }
  };

  window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return {
      width: 640,
      height: 320,
      top: 0,
      left: 0,
      bottom: 320,
      right: 640,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };

  // jsdom's getComputedStyle() leaves `transform` (and its vendor-prefixed aliases)
  // `undefined` for an element with no transform rule applied, where a real browser
  // always returns at least the string "none". vaul's own getTranslate() (its
  // Drawer.Handle release-drag bookkeeping — see drawer.tsx's own comment on why
  // DrawerContent renders the real Handle, not a lookalike div) unconditionally calls
  // `.match()` on that value, so any pointerup inside a Drawer with a visible handle
  // throws "Cannot read properties of undefined (reading 'match')" without this.
  const nativeGetComputedStyle = window.getComputedStyle.bind(window);
  window.getComputedStyle = ((elt: Element, pseudoElt?: string | null) => {
    const style = nativeGetComputedStyle(elt, pseudoElt);
    return new Proxy(style, {
      get(target, prop, receiver) {
        if (prop === "transform" || prop === "webkitTransform" || prop === "mozTransform") {
          return Reflect.get(target, prop, receiver) || "none";
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }) as typeof window.getComputedStyle;
}
