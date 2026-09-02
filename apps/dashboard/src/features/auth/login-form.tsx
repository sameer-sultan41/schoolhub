"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ApiError } from "@schoolhub/api-client";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from "@schoolhub/ui";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { login } from "@/lib/auth";
import { env } from "@/lib/env";
import { parseTenantSlug } from "@/lib/host";
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

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: "", password: "" },
  });
  const { handleSubmit, setError } = form;

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
      ? mutation.error.isUnauthenticated
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
          <Alert variant="danger">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <Form {...form}>
          <form
            className="space-y-4"
            // react-hook-form's handleSubmit always returns an async wrapper, so onSubmit
            // is a promise-returning function where the DOM expects void — but `void` alone
            // only silences that mismatch, it does not handle a rejection. A validation
            // failure itself never rejects (react-hook-form resolves that internally via
            // setError), and mutation.mutate is fire-and-forget, but an unexpected throw
            // inside the resolver would otherwise vanish as an unhandled rejection with
            // nothing here to say so — hence the explicit .catch(), matching app-shell.tsx's
            // sign-out handler rather than repeating its earlier, already-fixed mistake.
            onSubmit={(event) => {
              handleSubmit((values) => {
                // Tenant comes from the subdomain (<slug>.<platform-domain>:3000), not a
                // form field — `window` is safe here since this handler only ever runs
                // client-side, in response to a real submit event.
                const school = parseTenantSlug(
                  window.location.hostname,
                  env.NEXT_PUBLIC_PLATFORM_DOMAIN,
                );
                mutation.mutate(school ? { ...values, school } : values);
              })(event).catch((error: unknown) => {
                console.error("Unexpected error while submitting the sign-in form:", error);
              });
            }}
            noValidate
          >
            <FormField
              control={form.control}
              name="identifier"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("identifier")}</FormLabel>
                  <FormDescription>{t("identifierHint")}</FormDescription>
                  <FormControl required>
                    <Input {...field} autoComplete="username" autoFocus />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-baseline justify-between gap-2">
                    <FormLabel required>{t("password")}</FormLabel>
                    <Link
                      href="/forgot-password"
                      className="text-xs text-primary underline-offset-4 hover:underline"
                    >
                      {t("forgotPassword")}
                    </Link>
                  </div>
                  <FormControl required>
                    <Input {...field} type="password" autoComplete="current-password" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              block
              isLoading={mutation.isPending}
              loadingLabel={t("submitting")}
            >
              {t("submit")}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
