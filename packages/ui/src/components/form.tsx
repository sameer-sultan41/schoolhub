"use client";

import * as React from "react";
import { cn } from "../lib/cn";
import { Label } from "./label";
import { Slot } from "@radix-ui/react-slot";
import { type Label as LabelPrimitive } from "radix-ui";
import {
  Controller,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
  FormProvider,
  useFormContext,
} from "react-hook-form";

const Form = FormProvider;

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
  name: TName;
};

const FormFieldContext = React.createContext<FormFieldContextValue>({} as FormFieldContextValue);

const FormField = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  ...props
}: ControllerProps<TFieldValues, TName>) => {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
};

const useFormField = () => {
  const fieldContext = React.useContext(FormFieldContext);
  const itemContext = React.useContext(FormItemContext);
  const { getFieldState, formState } = useFormContext();

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
};

type FormItemContextValue = {
  id: string;
  /**
   * Whether a `<FormDescription>`/`<FormMessage>` is actually present among this
   * FormItem's children — computed once, synchronously, from `children` itself (no ref
   * registration or second render pass needed, since a parent always has its children
   * element tree available before its own first render). Metronic's own FormControl
   * points `aria-describedby` at both ids unconditionally, regardless of whether either
   * element is actually rendered in that FormItem — a dangling id reference is invalid
   * ARIA, and most fields here have no `<FormDescription>` at all.
   */
  hasDescription: boolean;
  hasMessage: boolean;
};

const FormItemContext = React.createContext<FormItemContextValue>({} as FormItemContextValue);

function FormItem({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const id = React.useId();
  const { error } = useFormField();
  // Function declarations (FormDescription/FormMessage, below) are hoisted, so referring
  // to them here — inside a callback that only runs at render time, well after module
  // evaluation — is safe despite their definitions appearing later in this file.
  const hasDescription = React.Children.toArray(children).some(
    (child) => React.isValidElement(child) && child.type === FormDescription,
  );
  const hasMessage = React.Children.toArray(children).some(
    (child) => React.isValidElement(child) && child.type === FormMessage,
  );

  return (
    <FormItemContext.Provider value={{ id, hasDescription, hasMessage }}>
      <div
        data-slot="form-item"
        className={cn("flex flex-col gap-2.5", className)}
        data-invalid={!!error}
        {...props}
      >
        {children}
      </div>
    </FormItemContext.Provider>
  );
}

function FormLabel({
  className,
  required = false,
  children,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root> & { required?: boolean }) {
  const { formItemId } = useFormField();

  return (
    <Label
      data-slot="form-label"
      className={cn("font-medium text-foreground", className)}
      htmlFor={formItemId}
      {...props}
    >
      {children}
      {required ? (
        <span className="ms-1 text-destructive" aria-hidden="true">
          *
        </span>
      ) : null}
    </Label>
  );
}

function FormControl({
  required,
  ...props
}: React.ComponentProps<typeof Slot> & { required?: boolean }) {
  const { error, formItemId, formDescriptionId, formMessageId, hasDescription, hasMessage } =
    useFormField();
  // Only reference an id when its element both exists in this FormItem's JSX and has
  // something to say — FormDescription always renders once present; FormMessage renders
  // exactly when there's an error (its own "return null" condition is `!body`, and body
  // is `error.message` in that branch), so checking `hasMessage && error?.message` rather
  // than just `hasMessage` mirrors that precisely: this must not reference an id no
  // element in the DOM actually has.
  const describedBy =
    [hasDescription ? formDescriptionId : null, hasMessage && error?.message ? formMessageId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <Slot
      data-slot="form-control"
      id={formItemId}
      aria-describedby={describedBy}
      aria-invalid={!!error}
      aria-required={required || undefined}
      {...props}
    />
  );
}

function FormDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  const { formDescriptionId, error } = useFormField();

  if (error) {
    return null; // Hide the description when there's an error
  }

  return (
    <div
      data-slot="form-description"
      id={formDescriptionId}
      className={cn("-mt-0.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

function FormMessage({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  const { error, formMessageId } = useFormField();
  const body = error ? String(error.message) : children;

  if (!body) {
    return null;
  }

  return (
    <div
      data-slot="form-message"
      id={formMessageId}
      // Not part of Metronic's own FormMessage — kept as a default rather than an
      // opt-in prop: a field-level error is exactly the kind of state assistive tech
      // needs announced without the reader having to go looking for it, and e2e's
      // login.page.ts (and this package's own component tests) locate errors by this
      // role to disambiguate a field-level error from the card-level API error.
      role="alert"
      className={cn("-mt-0.5 text-xs font-normal text-destructive", className)}
      {...props}
    >
      {body}
    </div>
  );
}

export {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useFormField,
};
