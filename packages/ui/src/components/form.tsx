"use client";

import { Slot } from "@radix-ui/react-slot";
import { type ComponentProps, createContext, useContext, useId } from "react";
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
  const { id } = itemContext;

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  };
}

export function FormItem({ className, ...props }: ComponentProps<"div">) {
  const id = useId();
  return (
    <FormItemContext.Provider value={{ id }}>
      <div className={cn("space-y-1.5", className)} {...props} />
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
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField();
  return (
    <Slot
      id={formItemId}
      aria-describedby={error ? `${formDescriptionId} ${formMessageId}` : formDescriptionId}
      aria-invalid={!!error}
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
