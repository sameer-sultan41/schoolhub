import "@testing-library/jest-dom";

// next-intl reads these in components under test; the real values come from the tenant.
process.env.NEXT_PUBLIC_API_BASE_URL ??= "https://api.test.invalid/api/v1";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
// Required by lib/env.ts's schema (no default) — any test importing @/lib/auth
// transitively imports env.ts, which throws at module load without this.
process.env.NEXT_PUBLIC_PLATFORM_DOMAIN ??= "schoolhub.test";

// jsdom implements neither the Pointer Events capture API nor scrollIntoView.
// Radix's Select (and other primitives built on @radix-ui/react-use-pointer-*)
// call element.hasPointerCapture/scrollIntoView unconditionally on open/select,
// so any test that interacts with one throws "target.hasPointerCapture is not
// a function" without these. Documented jsdom gap, not a real assertion to make.
if (typeof window !== "undefined") {
  window.HTMLElement.prototype.hasPointerCapture ??= () => false;
  window.HTMLElement.prototype.setPointerCapture ??= () => undefined;
  window.HTMLElement.prototype.releasePointerCapture ??= () => undefined;
  window.HTMLElement.prototype.scrollIntoView ??= () => undefined;
}
