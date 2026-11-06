"use client";

import { useState, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Control, FieldPath, FieldValues } from "react-hook-form";
import {
  Button,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from "@schoolhub/ui";

export interface PasswordFieldProps<TValues extends FieldValues> {
  control: Control<TValues>;
  name: FieldPath<TValues>;
  label: string;
  description?: string;
  autoComplete: "current-password" | "new-password";
  autoFocus?: boolean;
  /** Shown at the end of the label row, e.g. the sign-in form's "Forgot your password?". */
  labelAside?: ReactNode;
}

/** A required password input with a show/hide toggle, for the sign-in and set-password forms. */
export function PasswordField<TValues extends FieldValues>({
  control,
  name,
  label,
  description,
  autoComplete,
  autoFocus,
  labelAside,
}: PasswordFieldProps<TValues>) {
  const t = useTranslations("auth.password");
  const [visible, setVisible] = useState(false);

  return (
    <FormField
      control={control}
      name={name}
      render={({ field: { value, ...field } }) => (
        <FormItem>
          <div className="flex items-baseline justify-between gap-2">
            <FormLabel required>{label}</FormLabel>
            {labelAside}
          </div>
          {description ? <FormDescription>{description}</FormDescription> : null}
          {/* The toggle sits beside FormControl, not inside it: FormControl clones its
              aria-describedby/aria-invalid/id onto its one child via Slot, so wrapping both
              in a div would land them on the div instead of the <input>. */}
          <div className="relative">
            <FormControl required>
              <Input
                {...field}
                // The field's value is generic here; every caller's password field is a string.
                value={typeof value === "string" ? value : ""}
                type={visible ? "text" : "password"}
                autoComplete={autoComplete}
                autoFocus={autoFocus}
              />
            </FormControl>
            <Button
              type="button"
              variant="ghost"
              mode="icon"
              size="sm"
              onClick={() => {
                setVisible(!visible);
              }}
              className="absolute end-1 top-1/2 size-7 -translate-y-1/2 bg-transparent!"
              aria-label={visible ? t("hide") : t("show")}
            >
              {visible ? (
                <EyeOff className="text-muted-foreground" />
              ) : (
                <Eye className="text-muted-foreground" />
              )}
            </Button>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
