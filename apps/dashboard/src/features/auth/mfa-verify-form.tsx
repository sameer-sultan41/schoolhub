"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
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

import { Paths } from "@/config/paths";
import { homePathFor } from "@/lib/home-path";
import { safeNextPath } from "@/lib/safe-next-path";
import { ApiError, Services } from "@/services";
import { createMfaCodeSchema, type MfaCodeValues } from "@/services/modules/auth/auth.schema";
import { AuthPageHeader } from "./auth-page-header";

type Factor = "code" | "recovery";

/** Minutes to wait, rounded up, from a refusal's `Retry-After` seconds. */
function minutesFrom(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60));
}

/**
 * The second factor of a challenged sign-in (`/auth/mfa:verify`): a TOTP code, or one of the
 * recovery codes. Every refusal is a 400 or 429, never a 401, so this form never bounces to
 * sign-in on a wrong code; it says what happened and stays. A dead challenge (expired, used, or
 * too many wrong codes) is the one case that needs a new sign-in.
 *
 * The challenge lives in memory only (`lib/auth.ts`), so a reload drops it and the page asks the
 * user to sign in again.
 */
export function MfaVerifyForm() {
  const t = useTranslations("auth.mfa.verify");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [factor, setFactor] = useState<Factor>("code");
  // The server render has no challenge to know about; assume one, and the client corrects it.
  const hasChallenge = useSyncExternalStore(
    Services.auth.subscribeMfaChallenge,
    Services.auth.hasPendingMfaChallenge,
    () => true,
  );

  const mutation = useMutation({
    mutationFn: (values: MfaCodeValues) =>
      Services.auth.verifyMfa(
        factor === "code" ? { code: values.code } : { recovery_code: values.code },
      ),
    onSuccess: (session) => {
      // A new identity starts from an empty cache, as after a password-only sign-in.
      queryClient.clear();
      const next = searchParams.get("next");
      router.refresh();
      router.replace(safeNextPath(next) ?? homePathFor(session.user));
    },
  });

  const error = mutation.error instanceof ApiError ? mutation.error : null;
  const errorMessage = (() => {
    if (!error) return null;
    if (error.code === "mfa_locked") {
      return error.retryAfter !== null
        ? t("lockedFor", { minutes: minutesFrom(error.retryAfter) })
        : t("lockedByOperator");
    }
    return tErrors.has(error.code) ? tErrors(error.code) : error.message;
  })();

  if (!hasChallenge) {
    return (
      <div className="space-y-5">
        <AuthPageHeader title={t("title")} subtitle={t("expiredSubtitle")} />
        {errorMessage && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}
        <Link
          href={Paths.LOGIN}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          {t("signInAgain")}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <AuthPageHeader
        title={t("title")}
        subtitle={t(factor === "code" ? "subtitle" : "recoverySubtitle")}
      />
      {errorMessage && (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}
      <FactorForm
        key={factor}
        factor={factor}
        isPending={mutation.isPending}
        onSubmit={(values) => {
          mutation.mutate(values);
        }}
      />
      <Button
        type="button"
        variant="ghost"
        block
        onClick={() => {
          setFactor((current) => (current === "code" ? "recovery" : "code"));
          mutation.reset();
        }}
      >
        {t(factor === "code" ? "useRecovery" : "useCode")}
      </Button>
    </div>
  );
}

/**
 * One factor's field. Keyed by the factor, so switching remounts it with that factor's schema
 * (a resolver is fixed when the form is created).
 */
function FactorForm({
  factor,
  isPending,
  onSubmit,
}: {
  factor: Factor;
  isPending: boolean;
  onSubmit: (values: MfaCodeValues) => void;
}) {
  const t = useTranslations("auth.mfa.verify");
  const tCommon = useTranslations("common");
  // Built once per mount: the form remounts when the factor changes (its `key`).
  const [schema] = useState(() =>
    createMfaCodeSchema(factor, {
      codeInvalid: t("codeInvalid"),
      required: tCommon("requiredField"),
    }),
  );
  const form = useForm<MfaCodeValues>({
    resolver: zodResolver(schema),
    defaultValues: { code: "" },
  });

  return (
    <Form {...form}>
      <form
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          form
            .handleSubmit(onSubmit)(event)
            .catch((caught: unknown) => {
              console.error("Unexpected error while submitting the second factor:", caught);
            });
        }}
      >
        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <FormItem>
              <FormLabel required>{t(factor === "code" ? "code" : "recoveryCode")}</FormLabel>
              <FormControl required>
                <Input
                  {...field}
                  autoComplete="one-time-code"
                  inputMode={factor === "code" ? "numeric" : "text"}
                  autoFocus
                />
              </FormControl>
              <FormDescription>
                {t(factor === "code" ? "codeHint" : "recoveryHint")}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" block isLoading={isPending} loadingLabel={t("submitting")}>
          {t("submit")}
        </Button>
      </form>
    </Form>
  );
}
