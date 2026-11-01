"use client";

import { useCallback, useRef } from "react";

import type { BroadcastRequest } from "@/services/modules/broadcasts/broadcasts-type";

/**
 * What an idempotency key stands for: the request body and the preview it was confirmed
 * against. The server binds a key to its body, so a send that differs in any of these needs
 * a new key (the same key with another body is a `422 idempotency_key_reused`).
 */
export function broadcastSignature(
  request: BroadcastRequest,
  recipientCount: number,
  audienceDigest: string,
): string {
  return JSON.stringify([request, recipientCount, audienceDigest]);
}

/**
 * One `Idempotency-Key` per signature: a retry of the same send reuses it (so the server
 * replays, never double-sends), and any change to the signature mints a new one.
 */
export function useBroadcastKey() {
  const current = useRef<{ signature: string; key: string } | null>(null);

  const keyFor = useCallback((signature: string) => {
    if (current.current?.signature !== signature) {
      current.current = { signature, key: crypto.randomUUID() };
    }
    return current.current.key;
  }, []);

  /** Drops the key, so the next send mints a fresh one. */
  const forget = useCallback(() => {
    current.current = null;
  }, []);

  return { keyFor, forget };
}
