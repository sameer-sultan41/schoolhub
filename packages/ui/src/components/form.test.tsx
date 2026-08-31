import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { useForm } from "react-hook-form";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "./form";
import { Input } from "./input";

interface Values {
  email: string;
}

/** Minimal harness: a real RHF instance, one field, a manual trigger so tests control
 * exactly when validation runs rather than depending on submit/blur timing. */
function EmailField({ required = false }: { required?: boolean }) {
  const form = useForm<Values>({ defaultValues: { email: "" } });

  return (
    <Form {...form}>
      <button
        type="button"
        onClick={() => {
          form.setError("email", { type: "manual", message: "Enter a valid email address." });
        }}
      >
        Validate
      </button>
      <FormField
        control={form.control}
        name="email"
        render={({ field }) => (
          <FormItem>
            <FormLabel required={required}>Email</FormLabel>
            <FormDescription>We only use this to sign you in.</FormDescription>
            <FormControl required={required}>
              <Input {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </Form>
  );
}

describe("Form", () => {
  it("wires the label to the control and exposes the description via aria-describedby", () => {
    render(<EmailField />);

    const input = screen.getByRole("textbox", { name: "Email" });
    const describedBy = input.getAttribute("aria-describedby");

    expect(describedBy).toBeTruthy();
    expect(screen.getByText("We only use this to sign you in.").id).toBe(describedBy);
  });

  it("renders the required marker as aria-hidden, so it does not appear in the accessible name", () => {
    render(<EmailField required />);

    // A string `name` is an exact accessible-name match by default (no `exact` option on
    // ByRoleOptions in this testing-library version), which is exactly what proves the
    // "*" is excluded from the computed name — the behaviour e2e's login.page.ts relies on.
    expect(screen.getByRole("textbox", { name: "Email" })).toBeInTheDocument();
    expect(screen.getByText("*")).toHaveAttribute("aria-hidden", "true");
  });

  it("sets aria-invalid and a role=alert message once the field errors, and includes it in aria-describedby", async () => {
    render(<EmailField />);

    await userEvent.click(screen.getByRole("button", { name: "Validate" }));

    const input = screen.getByRole("textbox", { name: "Email" });
    expect(input).toHaveAttribute("aria-invalid", "true");

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Enter a valid email address.");
    expect(input.getAttribute("aria-describedby")).toContain(alert.id);
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = render(<EmailField required />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
