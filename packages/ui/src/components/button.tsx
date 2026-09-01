import { Slot } from "@radix-ui/react-slot";
import { type VariantProps, cva } from "class-variance-authority";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

/**
 * Colours come from theme tokens only (`bg-primary`, `text-danger`, …), which resolve to the
 * `--sh-*` custom properties a tenant's branding overrides. No literal colour lives here.
 */
const buttonVariants = cva(
  // disabled:* only ever matches the real :disabled CSS pseudo-class (native <button>
  // path, below); data-[disabled]:* is what makes the asChild path — usually an <a>,
  // which HTML disabled cannot apply to at all — visually match, driven by the explicit
  // data-disabled attribute that branch sets.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--sh-radius)] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:opacity-90",
        secondary: "bg-secondary text-secondary-foreground hover:opacity-90",
        outline: "border border-border bg-transparent text-foreground hover:bg-muted",
        ghost: "bg-transparent text-foreground hover:bg-muted",
        danger: "bg-danger text-danger-foreground hover:opacity-90",
        link: "bg-transparent text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4",
        lg: "h-11 px-6",
        icon: "size-10",
      },
      block: {
        true: "w-full",
        false: "",
      },
    },
    defaultVariants: { variant: "primary", size: "md", block: false },
  },
);

type ButtonOwnProps =
  | {
      /**
       * Render the styling onto a single child element (typically next/link's `<Link>`)
       * instead of a `<button>` — e.g. `<Button asChild><Link href="/x">Go</Link></Button>`.
       * `isLoading`/`leadingIcon`/`trailingIcon` and the forced `type` don't apply here:
       * the child owns its own content and, usually, isn't a submittable form control at
       * all — this branch is a compile-time error precisely so that isn't a silent no-op:
       * a Slot-wrapped child can't have a spinner injected into arbitrary content, so
       * there is no correct behaviour for isLoading here to fall back to.
       */
      asChild: true;
      isLoading?: never;
      loadingLabel?: never;
      leadingIcon?: never;
      trailingIcon?: never;
    }
  | {
      asChild?: false;
      /** Shows a spinner and disables the button. Use for in-flight mutations. */
      isLoading?: boolean;
      /** Announced by screen readers while `isLoading`. */
      loadingLabel?: string;
      leadingIcon?: ReactNode;
      trailingIcon?: ReactNode;
    };

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> &
  ButtonOwnProps;

export function Button({
  className,
  variant,
  size,
  block,
  isLoading = false,
  loadingLabel = "Loading",
  leadingIcon,
  trailingIcon,
  disabled,
  children,
  type = "button",
  asChild = false,
  ...props
}: ButtonProps) {
  if (asChild) {
    // `disabled` is destructured out above specifically so it does NOT reach `...props`
    // here unchanged — the native HTML attribute is meaningless on the <a> (or whatever
    // else) this branch typically wraps, and Slot would otherwise pass it through inert.
    // aria-disabled announces the state to assistive tech on any element; data-disabled
    // drives the visual treatment via buttonVariants' data-[disabled]:* classes above.
    return (
      <Slot
        className={cn(buttonVariants({ variant, size, block }), className)}
        aria-disabled={disabled || undefined}
        data-disabled={disabled || undefined}
        {...props}
      >
        {children}
      </Slot>
    );
  }

  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size, block }), className)}
      disabled={disabled === true || isLoading}
      aria-busy={isLoading || undefined}
      {...props}
    >
      {isLoading ? (
        <>
          <span
            aria-hidden="true"
            className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
          <span className="sr-only">{loadingLabel}</span>
        </>
      ) : (
        leadingIcon
      )}
      {children}
      {!isLoading && trailingIcon}
    </button>
  );
}

export { buttonVariants };
