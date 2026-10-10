import { render, screen } from "@testing-library/react";
import type * as SchoolhubUi from "@schoolhub/ui";
import { Drawer } from "@schoolhub/ui";

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
  useIsDrawer,
} from "@/components/responsive-dialog";
import { setMatchesMobile } from "@/test-utils";

// Wraps the real Drawer (forwarding every call to it) rather than stubbing it out: this
// file's other cases below exercise real rendering via data-slot queries, and vaul's own
// nested-vs-not behavior isn't observable in jsdom anyway (see packages/ui's own
// drawer.test.tsx) — a bare stub here would prove nothing. This wrapper only adds call
// tracking, so the two new cases below can assert the `nested` prop actually reaches
// `Drawer`, the one thing a DOM query can't show.
jest.mock("@schoolhub/ui", () => {
  const actual = jest.requireActual<typeof SchoolhubUi>("@schoolhub/ui");
  return { ...actual, Drawer: jest.fn(actual.Drawer) };
});

const mockDrawer = Drawer as jest.MockedFunction<typeof Drawer>;

describe("ResponsiveDialog", () => {
  afterEach(() => {
    setMatchesMobile(false);
  });

  it("renders a Dialog by default (desktop)", () => {
    // baseElement, not container: Dialog/Drawer both portal their content to
    // document.body, which lands as a sibling of container (the render wrapper div),
    // never a descendant of it — container.querySelector can't reach portalled content.
    const { baseElement } = render(
      <ResponsiveDialog open onOpenChange={jest.fn()}>
        <ResponsiveDialogContent closeLabel="Close">Hello</ResponsiveDialogContent>
      </ResponsiveDialog>,
    );

    expect(baseElement.querySelector('[data-slot="dialog-content"]')).toBeInTheDocument();
    expect(baseElement.querySelector('[data-slot="drawer-content"]')).not.toBeInTheDocument();
  });

  it("renders a Drawer instead, once matchMedia reports the mobile breakpoint", () => {
    setMatchesMobile(true);

    const { baseElement } = render(
      <ResponsiveDialog open onOpenChange={jest.fn()}>
        <ResponsiveDialogContent closeLabel="Close">Hello</ResponsiveDialogContent>
      </ResponsiveDialog>,
    );

    expect(baseElement.querySelector('[data-slot="drawer-content"]')).toBeInTheDocument();
    expect(baseElement.querySelector('[data-slot="dialog-content"]')).not.toBeInTheDocument();
  });

  it("applies a caller's className to the desktop Dialog but not the mobile Drawer", () => {
    setMatchesMobile(false);
    const desktop = render(
      <ResponsiveDialog open onOpenChange={jest.fn()}>
        <ResponsiveDialogContent closeLabel="Close" className="max-w-2xl">
          Hello
        </ResponsiveDialogContent>
      </ResponsiveDialog>,
    );
    expect(desktop.baseElement.querySelector('[data-slot="dialog-content"]')).toHaveClass(
      "max-w-2xl",
    );
    desktop.unmount();

    setMatchesMobile(true);
    const mobile = render(
      <ResponsiveDialog open onOpenChange={jest.fn()}>
        <ResponsiveDialogContent closeLabel="Close" className="max-w-2xl">
          Hello
        </ResponsiveDialogContent>
      </ResponsiveDialog>,
    );
    expect(mobile.baseElement.querySelector('[data-slot="drawer-content"]')).not.toHaveClass(
      "max-w-2xl",
    );
  });

  // The close button's presence is the only difference between the two branches, so each
  // case runs on the desktop Dialog and the mobile Drawer (they take differently named props).
  it.each([
    ["desktop dialog", false],
    ["mobile drawer", true],
  ])("shows the close button on the %s by default", (_label, mobile) => {
    setMatchesMobile(mobile);
    render(
      <ResponsiveDialog open onOpenChange={jest.fn()}>
        <ResponsiveDialogContent closeLabel="Close">
          <ResponsiveDialogTitle>T</ResponsiveDialogTitle>
        </ResponsiveDialogContent>
      </ResponsiveDialog>,
    );

    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it.each([
    ["desktop dialog", false],
    ["mobile drawer", true],
  ])("hides the close button on the %s when showCloseButton is false", (_label, mobile) => {
    setMatchesMobile(mobile);
    render(
      <ResponsiveDialog open onOpenChange={jest.fn()}>
        <ResponsiveDialogContent closeLabel="Close" showCloseButton={false}>
          <ResponsiveDialogTitle>T</ResponsiveDialogTitle>
        </ResponsiveDialogContent>
      </ResponsiveDialog>,
    );

    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  it("useIsDrawer throws when called outside a ResponsiveDialog/ResponsiveSheet", () => {
    function Unwrapped() {
      useIsDrawer();
      return null;
    }
    // React logs its own error to the console for a thrown render; silence just that.
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<Unwrapped />)).toThrow(
      "Responsive dialog subcomponents must be rendered inside <ResponsiveDialog>.",
    );

    consoleError.mockRestore();
  });

  it("passes nested through to Drawer on mobile", () => {
    setMatchesMobile(true);
    render(
      <ResponsiveDialog open onOpenChange={jest.fn()} nested>
        <div>content</div>
      </ResponsiveDialog>,
    );
    // React 19 still calls a function component with a second argument, but it's always
    // `undefined` now that legacy context is gone — not the `{}` older React passed.
    expect(mockDrawer).toHaveBeenCalledWith(expect.objectContaining({ nested: true }), undefined);
  });

  it("defaults nested to false when the prop is omitted", () => {
    setMatchesMobile(true);
    render(
      <ResponsiveDialog open onOpenChange={jest.fn()}>
        <div>content</div>
      </ResponsiveDialog>,
    );
    expect(mockDrawer).toHaveBeenCalledWith(expect.objectContaining({ nested: false }), undefined);
  });
});
