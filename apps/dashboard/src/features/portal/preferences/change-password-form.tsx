"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  Alert,
  Button,
  Card,
  CardContent,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from "@schoolhub/ui";

import { ImpersonationForbiddenNotice } from "@/components/impersonation-forbidden-notice";
import { useFormDialogSubmit } from "@/hooks/use-form-dialog-submit";
import { useIsImpersonating } from "@/hooks/use-is-impersonating";
import { Services } from "@/services";
import { PASSWORD_MIN_LENGTH } from "@/services/modules/auth/auth-constant";
import {
  createChangePasswordSchema,
  type ChangePasswordFormValues,
} from "@/services/modules/auth/auth.schema";

const DEFAULTS: ChangePasswordFormValues = {
  current_password: "",
  new_password: "",
  confirm_password: "",
};

/** The password inputs, in order, with the autofill hint each one wants. */
const FIELDS = [
  ["current_password", "currentPassword", "current-password"],
  ["new_password", "newPassword", "new-password"],
  ["confirm_password", "confirmPassword", "new-password"],
] as const;

/** `/portal/settings`: the viewer changes their own password. A wrong current password or a
 * password the server finds too weak shows under the field it names. */
export function ChangePasswordForm() {
  // Refused 403 `impersonation_forbidden` under impersonation (ADR-0037): say so, offer nothing.
  return useIsImpersonating() ? <ImpersonationForbiddenNotice /> : <ChangePasswordFields />;
}

function ChangePasswordFields() {
  const t = useTranslations("portal.preferences.password");
  const schema = useMemo(
    () =>
      createChangePasswordSchema({
        currentRequired: t("errors.currentRequired"),
        newTooShort: t("errors.newTooShort", { min: PASSWORD_MIN_LENGTH }),
        confirmMismatch: t("errors.confirmMismatch"),
        sameAsCurrent: t("errors.sameAsCurrent"),
      }),
    [t],
  );
  const form = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(schema),
    defaultValues: DEFAULTS,
  });

  const { handleSubmit, formError, isPending } = useFormDialogSubmit({
    form,
    mutationFn: (values) =>
      Services.auth.changePassword({
        current_password: values.current_password,
        new_password: values.new_password,
      }),
    knownFields: ["current_password", "new_password"],
    onSuccess: () => {
      form.reset(DEFAULTS);
      toast.success(t("done"));
    },
    fallbackMessage: t("failed"),
  });

  return (
    <Card>
      <CardContent className="space-y-4">
        <h2 className="font-heading text-base font-semibold text-foreground">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("description", { min: PASSWORD_MIN_LENGTH })}
        </p>
        <Form {...form}>
          <form noValidate onSubmit={handleSubmit} className="max-w-sm space-y-4">
            {formError && <Alert variant="destructive">{formError}</Alert>}
            {FIELDS.map(([name, labelKey, autoComplete]) => (
              <FormField
                key={name}
                control={form.control}
                name={name}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t(labelKey)}</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete={autoComplete} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
            <Button type="submit" isLoading={isPending} loadingLabel={t("submitting")}>
              {t("submit")}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
