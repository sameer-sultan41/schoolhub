"use client";

import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Alert, AlertDescription, Button, Form } from "@schoolhub/ui";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";

import { NON_FIELD, resolveErrorMessage } from "@/lib/error-message";
import { ApiError } from "@/services";
import { PASSWORD_MIN_LENGTH } from "@/services/modules/auth/auth-constant";
import { isUnusableLinkError } from "@/services/modules/auth/auth-helper";
import {
  createNewPasswordSchema,
  type NewPasswordValues,
} from "@/services/modules/auth/auth.schema";
import { PasswordField } from "./password-field";

export interface NewPasswordFormProps {
  /** Sends the chosen password; resolves on the API's `204`. */
  submit: (password: string) => Promise<void>;
  /** The request field the API names in a weak-password `validation_error`. */
  serverPasswordField: "password" | "new_password";
  submitLabel: string;
  submittingLabel: string;
  onSuccess: () => void;
  /** The link turned out to be unusable (`invalid_link`). */
  onInvalidLink: () => void;
}

/** Choose a password, typed twice: the body of the accept-invitation and reset-password pages. */
export function NewPasswordForm({
  submit,
  serverPasswordField,
  submitLabel,
  submittingLabel,
  onSuccess,
  onInvalidLink,
}: NewPasswordFormProps) {
  const t = useTranslations("auth.password");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const [formError, setFormError] = useState<string | null>(null);

  const schema = useMemo(
    () =>
      createNewPasswordSchema({
        tooShort: t("tooShort", { min: PASSWORD_MIN_LENGTH }),
        confirmRequired: t("confirmRequired"),
        mismatch: t("mismatch"),
      }),
    [t],
  );
  const form = useForm<NewPasswordValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const mutation = useMutation({
    mutationFn: (values: NewPasswordValues) => submit(values.password),
    onSuccess,
    onError: (error: unknown) => {
      if (isUnusableLinkError(error)) {
        onInvalidLink();
        return;
      }
      const passwordIssue =
        error instanceof ApiError ? error.fieldErrors()[serverPasswordField] : undefined;
      if (passwordIssue) {
        form.setError("password", { type: "server", message: passwordIssue });
        return;
      }
      setFormError(resolveErrorMessage(error, tErrors, tCommon("submitFailed"), NON_FIELD));
    },
  });

  return (
    <div className="space-y-4">
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}
      <Form {...form}>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            form
              .handleSubmit((values) => {
                setFormError(null);
                mutation.mutate(values);
              })(event)
              .catch((error: unknown) => {
                console.error("Unexpected error while submitting the password form:", error);
              });
          }}
        >
          <PasswordField
            control={form.control}
            name="password"
            label={t("new")}
            description={t("hint", { min: PASSWORD_MIN_LENGTH })}
            autoComplete="new-password"
            autoFocus
          />
          <PasswordField
            control={form.control}
            name="confirmPassword"
            label={t("confirm")}
            autoComplete="new-password"
          />
          <Button type="submit" block isLoading={mutation.isPending} loadingLabel={submittingLabel}>
            {submitLabel}
          </Button>
        </form>
      </Form>
    </div>
  );
}
