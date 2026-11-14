"use client";

import { useState } from "react";
import { Button } from "@schoolhub/ui";
import { Download } from "lucide-react";

/** A portal row's file download: busy while it runs, and a failure said in place under the
 * button so it can be tried again. `download` does the fetch and the save (a blob saved with
 * `saveBlob`, or a signed URL opened with `downloadFile`); `label` names the record, so each
 * button in a list has its own accessible name. */
export function PortalDownloadButton({
  label,
  failedMessage,
  download,
}: {
  label: string;
  failedMessage: string;
  download: () => Promise<void>;
}) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

  async function run() {
    setState("busy");
    try {
      await download();
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={state === "busy"}
        onClick={() => {
          void run();
        }}
      >
        <Download aria-hidden="true" />
        {label}
      </Button>
      {state === "error" ? (
        <span role="alert" className="text-xs text-destructive">
          {failedMessage}
        </span>
      ) : null}
    </span>
  );
}
