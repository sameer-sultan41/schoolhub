import { type InputHTMLAttributes, type ReactNode, useId } from "react";
import { cn } from "../lib/cn";

export interface FormFieldProps {
  label: ReactNode;
  /** Help text rendered under the label; wired to the control via aria-describedby. */
  description?: ReactNode;
  /**
   * Validation message. Prefer the API's `error.details[].issue` verbatim over an
   * invented string — see the error-envelope rule in AGENTS.md.
   */
  error?: string | undefined;
  required?: boolean;
  className?: string;
  /**
   * Render-prop for the control, so this works with any input (React Hook Form
   * `register`, a select, a date picker) without `packages/ui` depending on RHF.
   */
  children: (props: {
    id: string;
    "aria-describedby": string | undefined;
    "aria-invalid": boolean | undefined;
    "aria-required": boolean | undefined;
  }) => ReactNode;
}

export function FormField({
  label,
  description,
  error,
  required = false,
  className,
  children,
}: FormFieldProps) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
        {required ? (
          <span className="ms-1 text-danger" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>

      {description ? (
        <p id={descriptionId} className="text-xs text-muted-foreground">
          {description}
        </p>
      ) : null}

      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        "aria-required": required || undefined,
      })}

      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

/** Unstyled-but-tokenized text input, sized to pair with `Button size="md"`. */
export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-[var(--sh-radius)] border border-border bg-background px-3 text-sm text-foreground",
        "placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger",
        className,
      )}
      {...props}
    />
  );
}
