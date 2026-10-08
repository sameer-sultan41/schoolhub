import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ResponsiveAlertDialog } from "@/components/responsive-alert-dialog";
import { renderWithProviders, setMatchesMobile } from "@/test-utils";

function baseProps() {
  return {
    open: true,
    onOpenChange: jest.fn(),
    title: "Confirm",
    description: "Are you sure?",
    confirmLabel: "Confirm",
    onConfirm: jest.fn(),
    isPending: false,
  };
}

describe("ResponsiveAlertDialog", () => {
  afterEach(() => {
    setMatchesMobile(false);
  });

  it("renders the desktop AlertDialog primitive at desktop width", () => {
    const { baseElement } = renderWithProviders(<ResponsiveAlertDialog {...baseProps()} />);

    expect(baseElement.querySelector('[data-slot="alert-dialog-content"]')).toBeInTheDocument();
    expect(screen.queryByLabelText("Close")).not.toBeInTheDocument();
  });

  it("renders the mobile Drawer primitive below the desktop-shell breakpoint", () => {
    setMatchesMobile(true);

    renderWithProviders(<ResponsiveAlertDialog {...baseProps()} />);

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Close")).toBeInTheDocument();
  });

  it("renders the mobile Drawer, not the desktop primitive, in the 768-1023px range", () => {
    // useIsDesktopShell's breakpoint is 1024px (min-width) — a simulated 900px viewport
    // must still answer false to that query, so this component renders the Drawer here.
    // This is the exact gap the two wrong-breakpoint copies (keyed on useIsMobile's 768px
    // max-width, which would call 900px "not mobile" and wrongly show the desktop
    // primitive) get wrong — named in this component's own file comment.
    (window.matchMedia as jest.Mock).mockImplementation((query: string) => ({
      matches: /\(min-width:\s*([\d.]+)px\)/.exec(query)
        ? Number(/\(min-width:\s*([\d.]+)px\)/.exec(query)?.[1]) <= 900
        : false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));

    renderWithProviders(<ResponsiveAlertDialog {...baseProps()} />);

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Close")).toBeInTheDocument();
  });

  it("calls onConfirm without the dialog closing itself first", async () => {
    const onConfirm = jest.fn();
    renderWithProviders(<ResponsiveAlertDialog {...baseProps()} onConfirm={onConfirm} />);

    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("renders the error prop inline when set", () => {
    renderWithProviders(<ResponsiveAlertDialog {...baseProps()} error="Something went wrong" />);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("renders nothing for the error slot when no error is given", () => {
    renderWithProviders(<ResponsiveAlertDialog {...baseProps()} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables both buttons while isPending", () => {
    renderWithProviders(<ResponsiveAlertDialog {...baseProps()} isPending />);

    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});
