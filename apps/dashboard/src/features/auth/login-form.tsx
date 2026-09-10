"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ApiError } from "@schoolhub/api-client";
import {
  Alert,
  AlertDescription,
  Button,
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
import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { env } from "@/lib/env";
import { parseTenantSlug } from "@/lib/host";
import { getQueryClient, queryKeys } from "@/lib/query-client";
import { Services } from "@/services";

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
  const [passwordVisible, setPasswordVisible] = useState(false);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: "", password: "" },
  });
  const { handleSubmit, setError } = form;

  const mutation = useMutation({
    mutationFn: Services.auth.login,
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
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="font-heading text-lg font-semibold text-foreground">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {formError ? (
        <Alert variant="destructive">
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
          // nothing here to say so — hence the explicit .catch().
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
                {/* The toggle Button sits outside FormControl, as a sibling of it inside
                      this relative wrapper — not nested inside FormControl alongside Input.
                      FormControl clones its aria-describedby/aria-invalid/id props onto its
                      one child via Slot; wrapping both elements in a div would land those
                      props on the div instead of the actual <input>, breaking the a11y
                      wiring FormMessage depends on. */}
                <div className="relative">
                  <FormControl required>
                    <Input
                      {...field}
                      type={passwordVisible ? "text" : "password"}
                      autoComplete="current-password"
                    />
                  </FormControl>
                  <Button
                    type="button"
                    variant="ghost"
                    mode="icon"
                    size="sm"
                    onClick={() => {
                      setPasswordVisible(!passwordVisible);
                    }}
                    className="absolute end-1 top-1/2 size-7 -translate-y-1/2 bg-transparent!"
                    aria-label={passwordVisible ? "Hide password" : "Show password"}
                  >
                    {passwordVisible ? (
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

          <Button type="submit" block isLoading={mutation.isPending} loadingLabel={t("submitting")}>
            {t("submit")}
          </Button>
        </form>
      </Form>
    </div>
  );
}
