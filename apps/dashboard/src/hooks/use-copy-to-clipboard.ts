"use client";

import * as React from "react";

export function useCopyToClipboard({
  timeout = 2000,
  onCopy,
}: {
  timeout?: number;
  onCopy?: () => void;
} = {}) {
  const [isCopied, setIsCopied] = React.useState(false);

  // Returns a `Promise<boolean>` (resolves `true` on a genuine write, `false`
  // otherwise) so a caller can show a success/failure toast honestly, instead of
  // firing the write-text call without ever learning whether it worked.
  const copyToClipboard = (value: string): Promise<boolean> => {
    // `navigator.clipboard` itself is `undefined` outside a secure context (an http
    // LAN IP, a non-TLS staging host) — `?.` guards against reading `.writeText` off
    // `undefined`, which would otherwise throw synchronously before this check could
    // help.
    if (typeof window === "undefined" || !navigator.clipboard?.writeText) {
      return Promise.resolve(false);
    }

    if (!value) return Promise.resolve(false);

    return navigator.clipboard.writeText(value).then(
      () => {
        setIsCopied(true);

        if (onCopy) {
          onCopy();
        }

        setTimeout(() => {
          setIsCopied(false);
        }, timeout);

        return true;
      },
      (error) => {
        console.error(error);
        return false;
      },
    );
  };

  return { isCopied, copyToClipboard };
}
