"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Label,
} from "@schoolhub/ui";

import { Paths } from "@/config/paths";
import { resolveErrorMessage } from "@/lib/error-message";
import { homePathFor } from "@/lib/home-path";
import { ApiError, Services, type MfaEnrollResponse } from "@/services";
import { createMfaCodeSchema, type MfaCodeValues } from "@/services/modules/auth/auth.schema";
import { AuthPageHeader } from "./auth-page-header";

/** A QR code's side, in CSS pixels: large enough for a phone camera at arm's length. */
const QR_SIZE = 192;

/**
 * A platform operator's first sign-in turns TOTP on: start (a new secret, not yet enabled), scan
 * the QR code from `otpauth_uri` (or type the secret), confirm with a first code, then keep the ten
 * recovery codes, which are shown this once. The confirm answers a fresh session carrying the
 * second factor, so the console opens without signing in again.
 *
 * Reached with a password-only session (the console sends an operator without TOTP here). A
 * wrong code is a 400 and the step stays; no refusal here signs the user out.
 */
export function MfaEnrollForm() {
  const t = useTranslations("auth.mfa.enroll");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const queryClient = useQueryClient();
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

  const enrol = useMutation({ mutationFn: () => Services.auth.enrollMfa() });
  const confirm = useMutation({
    mutationFn: (values: MfaCodeValues) => Services.auth.confirmMfa(values.code),
    onSuccess: (session) => {
      setRecoveryCodes(session.recovery_codes);
      // `/auth/me` changed (mfa_enabled) and the session is new: nothing cached stays.
      queryClient.clear();
    },
  });

  if (recoveryCodes) {
    return (
      <div className="space-y-5">
        <AuthPageHeader title={t("codesTitle")} subtitle={t("codesSubtitle")} />
        <ul className="grid grid-cols-2 gap-2 rounded-md border border-border p-3 font-mono text-sm">
          {recoveryCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
        <Button
          type="button"
          variant="outline"
          block
          onClick={() => {
            void navigator.clipboard.writeText(recoveryCodes.join("\n")).then(
              () => toast.success(t("copied")),
              () => toast.error(t("copyFailed")),
            );
          }}
        >
          {t("copy")}
        </Button>
        <div className="flex items-start gap-2">
          <Checkbox
            id="mfa-codes-saved"
            checked={saved}
            onCheckedChange={(checked) => {
              setSaved(checked === true);
            }}
          />
          <Label htmlFor="mfa-codes-saved" className="font-normal">
            {t("savedConfirm")}
          </Label>
        </div>
        <Button
          type="button"
          block
          disabled={!saved}
          onClick={() => {
            router.refresh();
            router.replace(homePathFor(confirm.data?.user ?? { is_platform: true }));
          }}
        >
          {t("continue")}
        </Button>
      </div>
    );
  }

  const enrolment = enrol.data;
  if (!enrolment) {
    return (
      <div className="space-y-5">
        <AuthPageHeader title={t("title")} subtitle={t("subtitle")} />
        {enrol.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              {resolveErrorMessage(enrol.error, tErrors, tCommon("submitFailed"))}
            </AlertDescription>
          </Alert>
        )}
        {enrol.error instanceof ApiError && enrol.error.isUnauthenticated ? (
          <Link
            href={Paths.LOGIN}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            {t("signInAgain")}
          </Link>
        ) : (
          <Button
            type="button"
            block
            isLoading={enrol.isPending}
            loadingLabel={t("starting")}
            onClick={() => {
              enrol.mutate();
            }}
          >
            {t("start")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <ScanAndConfirm
      enrolment={enrolment}
      // `:confirm` goes through the auth proxy, which never refreshes: a 401 means the
      // password-only session ran out while the QR code was up.
      sessionEnded={confirm.error instanceof ApiError && confirm.error.isUnauthenticated}
      isPending={confirm.isPending}
      error={
        confirm.isError
          ? resolveErrorMessage(confirm.error, tErrors, tCommon("submitFailed"))
          : null
      }
      onSubmit={(values) => {
        confirm.mutate(values);
      }}
    />
  );
}

function ScanAndConfirm({
  enrolment,
  sessionEnded,
  isPending,
  error,
  onSubmit,
}: {
  enrolment: MfaEnrollResponse;
  sessionEnded: boolean;
  isPending: boolean;
  error: string | null;
  onSubmit: (values: MfaCodeValues) => void;
}) {
  const t = useTranslations("auth.mfa.enroll");
  const tVerify = useTranslations("auth.mfa.verify");
  const tCommon = useTranslations("common");
  const [schema] = useState(() =>
    createMfaCodeSchema("code", {
      codeInvalid: tVerify("codeInvalid"),
      required: tCommon("requiredField"),
    }),
  );
  const form = useForm<MfaCodeValues>({
    resolver: zodResolver(schema),
    defaultValues: { code: "" },
  });

  return (
    <div className="space-y-5">
      <AuthPageHeader title={t("scanTitle")} subtitle={t("scanSubtitle")} />
      {/* Dark on light, whatever the theme: a phone camera reads a QR code only that way round. */}
      <div className="flex justify-center rounded-md border border-border p-3">
        <QRCodeSVG
          value={enrolment.otpauth_uri}
          size={QR_SIZE}
          level="M"
          marginSize={4}
          title={t("qrTitle")}
        />
      </div>
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">{t("manualEntry")}</p>
        <p className="font-mono text-sm break-all" dir="ltr">
          {enrolment.secret}
        </p>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {sessionEnded && (
        <Link
          href={Paths.LOGIN}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          {t("signInAgain")}
        </Link>
      )}
      <Form {...form}>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            form
              .handleSubmit(onSubmit)(event)
              .catch((caught: unknown) => {
                console.error("Unexpected error while confirming the second factor:", caught);
              });
          }}
        >
          <FormField
            control={form.control}
            name="code"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{tVerify("code")}</FormLabel>
                <FormControl required>
                  <Input {...field} autoComplete="one-time-code" inputMode="numeric" />
                </FormControl>
                <FormDescription>{t("codeHint")}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" block isLoading={isPending} loadingLabel={t("confirming")}>
            {t("confirm")}
          </Button>
        </form>
      </Form>
    </div>
  );
}
