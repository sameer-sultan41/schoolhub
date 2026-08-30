"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ApiError } from "@schoolhub/api-client";
import { Button, Card, CardContent, FormField, Input } from "@schoolhub/ui";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { login } from "@/lib/auth";
import { getQueryClient, queryKeys } from "@/lib/query-client";

/**
 * Zod schema mirrors the API's validation (module doc §11) so the user gets instant feedback,
 * but the API remains the authority — its `error.details` are surfaced verbatim below.
 */
const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

type LoginValues = z.infer<typeof loginSchema>;

export function LoginForm() {
  const t = useTranslations("auth.login");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const searchParams = useSearchParams();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: "", password: "" },
  });

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: () => {
      // Fire-and-forget: the redirect below does not need the cache to have settled first.
      void getQueryClient().invalidateQueries({ queryKey: queryKeys.session() });
      const next = searchParams.get("next");
      router.replace(next?.startsWith("/") ? next : "/dashboard");
    },
    onError: (error: unknown) => {
      if (!(error instanceof ApiError)) return;
      // Map the envelope's field details onto the form; never invent a message for a known code.
      for (const [field, issue] of Object.entries(error.fieldErrors())) {
        if (field === "identifier" || field === "password") {
          setError(field, { type: "server", message: issue });
        }
      }
    },
  });

  const formError =
    mutation.error instanceof ApiError
      ? mutation.error.status === 401
        ? t("genericError")
        : tErrors.has(mutation.error.code)
          ? tErrors(mutation.error.code)
          : mutation.error.message
      : null;

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <div className="space-y-1">
          <h1 className="font-heading text-lg font-semibold text-foreground">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>

        {formError ? (
          <p
            role="alert"
            className="rounded-[var(--sh-radius)] border border-danger px-3 py-2 text-sm text-danger"
          >
            {formError}
          </p>
        ) : null}

        <form
          className="space-y-4"
          // react-hook-form's handleSubmit always returns an async wrapper — even though
          // mutation.mutate itself is fire-and-forget — so onSubmit must explicitly discard
          // that promise rather than let React silently drop a validation-time rejection.
          onSubmit={(event) =>
            void handleSubmit((values) => {
              mutation.mutate(values);
            })(event)
          }
          noValidate
        >
          <FormField
            label={t("identifier")}
            description={t("identifierHint")}
            error={errors.identifier?.message}
            required
          >
            {(field) => (
              <Input {...field} {...register("identifier")} autoComplete="username" autoFocus />
            )}
          </FormField>

          <FormField label={t("password")} error={errors.password?.message} required>
            {(field) => (
              <Input
                {...field}
                {...register("password")}
                type="password"
                autoComplete="current-password"
              />
            )}
          </FormField>

          <Button type="submit" block isLoading={mutation.isPending} loadingLabel={t("submitting")}>
            {t("submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
