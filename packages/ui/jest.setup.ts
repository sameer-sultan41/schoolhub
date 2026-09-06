import "@testing-library/jest-dom";
import { toHaveNoViolations } from "jest-axe";

// Unlike jest-dom, jest-axe doesn't self-register on import — it exports a matcher
// object that has to be handed to expect.extend explicitly.
expect.extend(toHaveNoViolations);

// jsdom gaps Recharts depends on. Guarded the same way apps/dashboard's setup is: this
// file runs for every suite in the package, and one using `@jest-environment node` would
// have no `window` at all.
if (typeof window !== "undefined") {
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
}
