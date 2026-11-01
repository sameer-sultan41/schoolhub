"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge, Button } from "@schoolhub/ui";

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { SEARCH_DEBOUNCE_MS } from "@/lib/constants";
import { resolveErrorMessage } from "@/lib/error-message";
import { queryKeys } from "@/lib/query-client";
import { Services } from "@/services";
import { MESSAGE_THREADS_QUERY_MODULE } from "@/services/modules/message-threads/message-threads-constant";
import type { ThreadRecipient } from "@/services/modules/message-threads/message-threads-type";

import { PickerPopover } from "./picker-popover";

export interface RecipientPickerProps {
  value: ThreadRecipient[];
  onChange: (value: ThreadRecipient[]) => void;
  /** `group` takes several recipients; `internal` takes exactly one, which a new pick replaces. */
  multiple: boolean;
}

/** Staff the viewer may add to an internal or group thread, searched through the API. */
export function RecipientPicker({ value, onChange, multiple }: RecipientPickerProps) {
  const t = useTranslations("communication.messages.picker");
  const tErrors = useTranslations("errors");
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const search = useDebouncedValue(input.trim(), SEARCH_DEBOUNCE_MS);

  const recipients = useQuery({
    queryKey: queryKeys.list(MESSAGE_THREADS_QUERY_MODULE, "recipients", { search }),
    queryFn: () => Services.messageThreads.searchRecipients(search),
    enabled: open,
  });

  const chosen = new Set(value.map((recipient) => recipient.user_id));
  const options = (recipients.data ?? [])
    .filter((recipient) => !chosen.has(recipient.user_id))
    .map((recipient) => ({ id: recipient.user_id, label: recipient.name, hint: recipient.role }));

  function pick(userId: string) {
    const recipient = recipients.data?.find((candidate) => candidate.user_id === userId);
    if (recipient) onChange(multiple ? [...value, recipient] : [recipient]);
  }

  return (
    <PickerPopover
      triggerLabel={t(multiple ? "addRecipients" : "chooseRecipient")}
      open={open}
      onOpenChange={setOpen}
      searchLabel={t("searchRecipients")}
      search={input}
      onSearchChange={setInput}
      options={options}
      isLoading={recipients.isPending}
      error={
        recipients.isError ? resolveErrorMessage(recipients.error, tErrors, t("failed")) : null
      }
      onPick={pick}
      closeOnPick={!multiple}
    >
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((recipient) => (
            <li key={recipient.user_id}>
              <Badge variant="secondary" appearance="light" size="lg">
                {recipient.name}
                <Button
                  type="button"
                  variant="ghost"
                  mode="icon"
                  size="sm"
                  className="size-4"
                  aria-label={t("remove", { name: recipient.name })}
                  onClick={() => {
                    onChange(value.filter((other) => other.user_id !== recipient.user_id));
                  }}
                >
                  <X aria-hidden="true" />
                </Button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </PickerPopover>
  );
}
