"use client";

import { useEffect, useRef, useState } from "react";

import { readLinkFragment } from "@/services/modules/auth/auth-helper";

/**
 * Reads an emailed link's values out of the URL fragment once, then clears the fragment
 * from the address bar and the history entry, so the token is not left in the URL to be
 * copied, synced or shown again (ADR-0033). The fragment never reaches a server or a
 * `Referer` header; clearing it keeps it out of the browser's history too.
 *
 * `undefined` until the effect has run (the server render has no fragment to read);
 * `null` when the link is missing a value, which is as unusable as a wrong one.
 */
export function useLinkFragment<const TKey extends string>(
  keys: readonly TKey[],
): Record<TKey, string> | null | undefined {
  const [link, setLink] = useState<Record<TKey, string> | null | undefined>(undefined);
  // A ref, not the state: Strict Mode runs this effect twice, and the second run would
  // find the fragment already cleared and overwrite the link with `null`.
  const read = useRef(false);

  useEffect(() => {
    if (read.current) return;
    read.current = true;
    setLink(readLinkFragment(window.location.hash, keys));
    if (window.location.hash) {
      const { pathname, search } = window.location;
      window.history.replaceState(window.history.state, "", `${pathname}${search}`);
    }
  }, [keys]);

  return link;
}
