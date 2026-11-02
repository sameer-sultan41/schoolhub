"use client";

import { useTranslations } from "next-intl";
import { Alert, Label, Textarea } from "@schoolhub/ui";

import { BROADCAST_MESSAGE_MAX_LENGTH } from "@/services/modules/broadcasts/broadcasts-constant";

export interface MessageStepProps {
  message: string;
  onChange: (message: string) => void;
  /** The message rule that failed, already translated. */
  error?: string;
}

/** Step 2: the text, with a counter against the API's length limit. */
export function MessageStep({ message, onChange, error }: MessageStepProps) {
  const t = useTranslations("communication.broadcast.message");

  return (
    <div className="space-y-2">
      <Label htmlFor="broadcast-message">{t("label")}</Label>
      <Textarea
        id="broadcast-message"
        rows={6}
        maxLength={BROADCAST_MESSAGE_MAX_LENGTH}
        placeholder={t("placeholder")}
        value={message}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      <p className="text-xs text-muted-foreground">
        {t("counter", { count: message.length, max: BROADCAST_MESSAGE_MAX_LENGTH })}
      </p>
      {error && <Alert variant="destructive">{error}</Alert>}
    </div>
  );
}
