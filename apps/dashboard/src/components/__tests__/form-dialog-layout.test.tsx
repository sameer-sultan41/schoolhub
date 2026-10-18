import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SyntheticEvent } from "react";
import { useForm } from "react-hook-form";

import { renderWithProviders, setMatchesMobile } from "@/test-utils";

import { FormDialogLayout, type FormDialogLayoutProps } from "../form-dialog-layout";

interface Values {
  name: string;
}

type HarnessProps = Partial<
  Omit<FormDialogLayoutProps<Values>, "form" | "children" | "submittingLabel">
>;

/** The layout over a real form, with a submit handler that only records the submit. */
function Harness({
  onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
  },
  ...props
}: HarnessProps) {
  const form = useForm<Values>({ defaultValues: { name: "" } });

  return (
    <FormDialogLayout
      open
      onOpenChange={jest.fn()}
      title="Edit thing"
      formError={null}
      isPending={false}
      submittingLabel="Saving"
      {...props}
      form={form}
      onSubmit={onSubmit}
    >
      <p>The fields</p>
    </FormDialogLayout>
  );
}

describe("FormDialogLayout", () => {
  afterEach(() => {
    setMatchesMobile(false);
  });

  it("shows the title, the fields, and Cancel and Save", () => {
    renderWithProviders(<Harness />);

    expect(screen.getByRole("dialog", { name: "Edit thing" })).toBeInTheDocument();
    expect(screen.getByText("The fields")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("shows the intro and the server's message above the fields", () => {
    renderWithProviders(<Harness description="Pick a thing." formError="It was refused." />);

    const intro = screen.getByText("Pick a thing.");
    const alert = screen.getByRole("alert");
    const fields = screen.getByText("The fields");
    expect(alert).toHaveTextContent("It was refused.");
    expect(intro.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(alert.compareDocumentPosition(fields) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows no intro or message when there are none", () => {
    renderWithProviders(<Harness />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("submits the form on Save", async () => {
    const onSubmit = jest.fn((event: SyntheticEvent) => {
      event.preventDefault();
    });
    renderWithProviders(<Harness onSubmit={onSubmit} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("labels the submit button with submitLabel when one is given", () => {
    renderWithProviders(<Harness submitLabel="Clone" />);

    expect(screen.getByRole("button", { name: "Clone" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("closes on Cancel without submitting", async () => {
    const onOpenChange = jest.fn();
    const onSubmit = jest.fn();
    renderWithProviders(<Harness onOpenChange={onOpenChange} onSubmit={onSubmit} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables Save and says it is saving while pending", () => {
    renderWithProviders(<Harness isPending />);

    expect(screen.getByText("Saving").closest("button")).toBeDisabled();
  });

  it("scrolls the body within a height bound on desktop", () => {
    const { baseElement } = renderWithProviders(<Harness />);

    expect(baseElement.querySelector("form")).not.toHaveClass("flex-col");
    expect(screen.getByText("The fields").parentElement).toHaveClass("max-h-[65vh]");
  });

  it("fills the drawer instead, below the desktop-shell breakpoint", () => {
    setMatchesMobile(true);

    const { baseElement } = renderWithProviders(<Harness />);

    expect(baseElement.querySelector('[data-slot="drawer-content"]')).toBeInTheDocument();
    expect(baseElement.querySelector("form")).toHaveClass("flex", "min-h-0", "grow", "flex-col");
    expect(screen.getByText("The fields").parentElement).not.toHaveClass("max-h-[65vh]");
  });
});
