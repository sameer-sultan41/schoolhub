import { render } from "@testing-library/react";

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  useIsDrawer,
} from "@/components/responsive-dialog";
import { setMatchesMobile } from "@/test-utils";

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
});
