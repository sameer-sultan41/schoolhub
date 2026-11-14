"use client";

import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Alert,
  AlertDescription,
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from "@schoolhub/ui";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Paths } from "@/config/paths";
import { env } from "@/lib/env";
import { NON_FIELD, resolveErrorMessage } from "@/lib/error-message";
import { parseTenantSlug } from "@/lib/host";
import { ApiError, Services } from "@/services";
import {
  createForgotPasswordSchema,
  type ForgotPasswordValues,
} from "@/services/modules/auth/auth.schema";
import { AuthPageHeader } from "./auth-page-header";

/**
 * `/forgot-password`: emails a reset link. The school comes from the host, as on the
 * sign-in form. The API answers `204` whether or not the email has an account, so the
 * confirmation never says which.
 */
export function ForgotPasswordForm() {
  const t = useTranslations("auth.forgotPassword");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const schema = useMemo(
    () => createForgotPasswordSchema({ invalidEmail: t("invalidEmail") }),
    [t],
  );
  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  const mutation = useMutation({
    mutationFn: Services.auth.requestPasswordReset,
    onSuccess: () => {
      toast.success(t("success"));
      router.replace(Paths.LOGIN);
    },
    onError: (error: unknown) => {
      const emailIssue = error instanceof ApiError ? error.fieldErrors()["email"] : undefined;
      if (emailIssue) {
        form.setError("email", { type: "server", message: emailIssue });
        return;
      }
      setFormError(resolveErrorMessage(error, tErrors, tCommon("submitFailed"), NON_FIELD));
    },
  });

  return (
    <div className="space-y-5">
      <AuthPageHeader title={t("title")} subtitle={t("subtitle")} />

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
                // The tenant comes from the subdomain, as on the sign-in form; `window` is
                // safe here since this only runs in response to a real submit.
                const school = parseTenantSlug(
                  window.location.hostname,
                  env.NEXT_PUBLIC_PLATFORM_DOMAIN,
                );
                if (!school) {
                  setFormError(t("noSchool"));
                  return;
                }
                mutation.mutate({ school, email: values.email });
              })(event)
              .catch((error: unknown) => {
                console.error("Unexpected error while submitting the reset request:", error);
              });
          }}
        >
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t("email")}</FormLabel>
                <FormControl required>
                  <Input {...field} type="email" autoComplete="email" autoFocus />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" block isLoading={mutation.isPending} loadingLabel={t("submitting")}>
            {t("submit")}
          </Button>
        </form>
      </Form>

      <Link
        href={Paths.LOGIN}
        className="block text-sm text-primary underline-offset-4 hover:underline"
      >
        {t("backToSignIn")}
      </Link>
    </div>
  );
}
