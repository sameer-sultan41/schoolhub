"use client";

/**
 * This file makes react-hook-form a hard `dependencies` entry of @schoolhub/ui, reversing
 * a constraint the render-prop FormField this replaced stated explicitly in its own
 * comment: "so this works with any input … without packages/ui depending on RHF." That
 * was the right call for a hand-rolled, RHF-agnostic field wrapper; it stops applying the
 * moment the goal becomes adopting shadcn's actual Form/FormField/FormItem/FormControl
 * pattern, which IS RHF's Controller API by design — an RHF-optional version of this
 * specific pattern isn't a smaller version of the same thing, it's a different component.
 * Named here rather than left implicit, since it was previously dropped without comment.
 *
 * Confirmed, not hypothetical: a real `next build` of apps/website shows react-hook-form
 * and @radix-ui/react-dialog do NOT reach any client chunk — tree-shaking eliminates both,
 * since neither has an unconditional top-level side effect. sonner did reach one (a ~220KB
 * chunk, the largest in the build, on every route) even after apps/website's one plain-
 * function import of this package was moved off the barrel — because several *other* files
 * there legitimately import Button/Card/Alert/Skeleton from the same barrel, and the barrel
 * re-exported Toaster unconditionally alongside them. apps/website never renders <Toaster>
 * at all. Root cause was sonner's CSS-injection IIFE running unconditionally at
 * module-evaluation time, which no bundler can prove safe to drop once anything reaches
 * that module — so no single import site could fix this while the barrel kept offering
 * Toaster to every consumer. Fixed at the source instead: Toaster is no longer exported
 * from "." at all (see index.ts) — it's @schoolhub/ui/toaster now, a separate subpath the
 * one real consumer (apps/dashboard's providers.tsx) imports explicitly, so a consumer of
 * anything else here no longer touches sonner's module unless it actually wants a toaster.
 */
import { Slot } from "@radix-ui/react-slot";
import {
  Children,
  type ComponentProps,
  createContext,
  isValidElement,
  useContext,
  useId,
} from "react";
import {
  Controller,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
  FormProvider,
  useFormContext,
  useFormState,
} from "react-hook-form";
import { cn } from "../lib/cn";
import { Label } from "./label";

export const Form = FormProvider;

interface FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> {
  name: TName;
}

const FormFieldContext = createContext<FormFieldContextValue | null>(null);

export function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>(props: ControllerProps<TFieldValues, TName>) {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
}

interface FormItemContextValue {
  id: string;
  /**
   * Whether a `<FormDescription>`/`<FormMessage>` is actually present among this
   * FormItem's children — computed once, synchronously, from `children` itself (no ref
   * registration or second render pass needed, since a parent always has its children
   * element tree available before its own first render). `hasMessage` only means the
   * element exists in JSX; whether it currently has anything to say is `error` — read
   * together in FormControl, matching FormMessage's own "return null" condition exactly.
   */
  hasDescription: boolean;
  hasMessage: boolean;
}

const FormItemContext = createContext<FormItemContextValue | null>(null);

/**
 * Reproduces the exact id/aria wiring the previous render-prop FormField computed by
 * hand: one useId()-derived base id, a description id and an error id that only exist
 * when their content does, joined into aria-describedby. e2e's login.page.ts locates
 * fields by accessible name (getByRole), which depends on this staying correct.
 */
export function useFormField() {
  const fieldContext = useContext(FormFieldContext);
  const itemContext = useContext(FormItemContext);
  const { getFieldState } = useFormContext();
  const formState = useFormState({ name: fieldContext?.name });

  if (!fieldContext) throw new Error("useFormField must be used within <FormField>");
  if (!itemContext) throw new Error("useFormField must be used within <FormItem>");

  const fieldState = getFieldState(fieldContext.name, formState);
  const { id, hasDescription, hasMessage } = itemContext;

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    hasDescription,
    hasMessage,
    ...fieldState,
  };
}

export function FormItem({ className, children, ...props }: ComponentProps<"div">) {
  const id = useId();
  // Function declarations (FormDescription/FormMessage, below) are hoisted, so referring
  // to them here — inside a callback that only runs at render time, well after module
  // evaluation — is safe despite their definitions appearing later in this file.
  const hasDescription = Children.toArray(children).some(
    (child) => isValidElement(child) && child.type === FormDescription,
  );
  const hasMessage = Children.toArray(children).some(
    (child) => isValidElement(child) && child.type === FormMessage,
  );
  return (
    <FormItemContext.Provider value={{ id, hasDescription, hasMessage }}>
      <div className={cn("space-y-1.5", className)} {...props}>
        {children}
      </div>
    </FormItemContext.Provider>
  );
}

export function FormLabel({
  className,
  required = false,
  children,
  ...props
}: ComponentProps<typeof Label> & { required?: boolean }) {
  const { error, formItemId } = useFormField();
  return (
    <Label htmlFor={formItemId} className={cn(error && "text-danger", className)} {...props}>
      {children}
      {required ? (
        <span className="ms-1 text-danger" aria-hidden="true">
          *
        </span>
      ) : null}
    </Label>
  );
}

export function FormControl({
  required,
  ...props
}: ComponentProps<typeof Slot> & { required?: boolean }) {
  const { error, formItemId, formDescriptionId, formMessageId, hasDescription, hasMessage } =
    useFormField();
  // Only reference an id when its element both exists in this FormItem's JSX and has
  // something to say — FormDescription always renders once present; FormMessage renders
  // exactly when `error` is set (its own "return null" condition), so pairing hasMessage
  // with error here mirrors that precisely rather than guessing from error alone.
  const describedBy =
    [hasDescription ? formDescriptionId : null, hasMessage && error ? formMessageId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <Slot
      id={formItemId}
      aria-describedby={describedBy}
      aria-invalid={error ? true : undefined}
      aria-required={required || undefined}
      {...props}
    />
  );
}

export function FormDescription({ className, ...props }: ComponentProps<"p">) {
  const { formDescriptionId } = useFormField();
  return (
    <p
      id={formDescriptionId}
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

/**
 * `role="alert"` matches the previous FormField's error paragraph exactly — e2e's
 * login.page.ts comment documents relying on this to disambiguate a field-level error
 * from the card-level API error (also role="alert", scoped by its own text).
 */
export function FormMessage({ className, children, ...props }: ComponentProps<"p">) {
  const { error, formMessageId } = useFormField();
  const body = error ? error.message : children;
  if (!body) return null;

  return (
    <p id={formMessageId} role="alert" className={cn("text-xs text-danger", className)} {...props}>
      {body}
    </p>
  );
}
