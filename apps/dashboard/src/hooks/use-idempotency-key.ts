"use client";

import { useCallback, useEffect, useRef } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";

/**
 * The `Idempotency-Key` of one intent (a payment, a refund, an upload), held in a ref for the
 * dialog's lifetime. `current()` hands out the same key until `clear()`, so a double submit or a
 * retry after a lost response replays the first answer instead of doing the work twice. It is
 * dropped whenever the form changes: the server refuses one key with a different body, and an
 * edited form is a different request. The caller clears it on success (the intent is done).
 */
export function useIdempotencyKey<TValues extends FieldValues>(form: UseFormReturn<TValues>) {
  const keyRef = useRef<string | null>(null);

  useEffect(() => {
    const subscription = form.watch(() => {
      keyRef.current = null;
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [form]);

  const current = useCallback(() => {
    keyRef.current ??= crypto.randomUUID();
    return keyRef.current;
  }, []);
  const clear = useCallback(() => {
    keyRef.current = null;
  }, []);

  return { current, clear };
}
