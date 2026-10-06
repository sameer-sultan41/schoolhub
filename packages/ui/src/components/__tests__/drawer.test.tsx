import { render, screen } from "@testing-library/react";
import type * as Vaul from "vaul";

// Prefixed `mock*` because babel-plugin-jest-hoist only allows a jest.mock() factory to
// close over an out-of-scope variable when it's named that way — anything else is a
// compile-time error once jest.mock() is hoisted above these declarations. Referenced
// lazily (wrapped in an arrow, not passed directly as `Root: mockRoot`) because that same
// hoisting moves this file's *value* import of `../drawer` (and so `require("vaul")`,
// and so this factory's invocation) above these `const` lines too — reading `mockRoot`'s
// value directly inside the factory body would throw "Cannot access before initialization".
// Wrapping defers the read until React actually calls `Root`/`NestedRoot`, well after the
// whole file's top-level code — including these `const`s — has finished running. See the
// real, working precedent for the `mock`-prefix half of this at
// apps/dashboard/src/lib/__tests__/auth.test.ts (its mocked import is type-only, so it
// never hits the lazy-reference half of this problem).
const mockRoot = jest.fn((props: { children?: React.ReactNode }) => <>{props.children}</>);
const mockNestedRoot = jest.fn((props: { children?: React.ReactNode }) => <>{props.children}</>);

jest.mock("vaul", () => {
  const actual = jest.requireActual<typeof Vaul>("vaul");
  return {
    ...actual,
    Drawer: {
      ...actual.Drawer,
      Root: (props: Parameters<typeof mockRoot>[0]) => mockRoot(props),
      NestedRoot: (props: Parameters<typeof mockNestedRoot>[0]) => mockNestedRoot(props),
    },
  };
});

import { Drawer } from "../drawer";

describe("Drawer nested mode", () => {
  afterEach(() => {
    mockRoot.mockClear();
    mockNestedRoot.mockClear();
  });

  it("renders vaul's Root by default", () => {
    render(
      <Drawer open onOpenChange={jest.fn()}>
        <div>content</div>
      </Drawer>,
    );

    expect(screen.getByText("content")).toBeInTheDocument();
    expect(mockRoot).toHaveBeenCalled();
    expect(mockNestedRoot).not.toHaveBeenCalled();
  });

  it("renders vaul's NestedRoot when nested is true, never Root", () => {
    render(
      <Drawer open onOpenChange={jest.fn()} nested>
        <div>nested content</div>
      </Drawer>,
    );

    expect(screen.getByText("nested content")).toBeInTheDocument();
    expect(mockNestedRoot).toHaveBeenCalled();
    expect(mockRoot).not.toHaveBeenCalled();
  });
});
