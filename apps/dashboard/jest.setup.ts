import "@testing-library/jest-dom";

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
  // jsdom has no matchMedia implementation; @schoolhub/ui's Sidebar (via use-mobile) calls
  // it unconditionally on mount. Defaults to "not mobile" (desktop) — tests that need the
  // mobile branch override matches for that one call.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: false,
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
}
