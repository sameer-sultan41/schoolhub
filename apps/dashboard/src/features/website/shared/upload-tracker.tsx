"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";

/**
 * The uploads a website form has in flight. Every `ImageFileField` under the provider reports
 * its upload here, so the host can hold Save while any is running (`isUploading`) and, for a
 * submit that still gets through (Enter in a text input), wait for them all (`settled`) before
 * it reads the form: an upload in progress is never silently dropped (dashboard-screen §5).
 */
export interface UploadTracker {
  isUploading: boolean;
  /** Registers one upload; it must resolve once its file id is in the form. */
  track: (upload: Promise<unknown>) => void;
  /** Resolves once every upload tracked so far, and any started meanwhile, has settled. */
  settled: () => Promise<void>;
}

export function useUploadTracker(): UploadTracker {
  const pendingRef = useRef(new Set<Promise<unknown>>());
  const [count, setCount] = useState(0);

  const track = useCallback((upload: Promise<unknown>) => {
    pendingRef.current.add(upload);
    setCount((current) => current + 1);
    const done = () => {
      pendingRef.current.delete(upload);
      setCount((current) => current - 1);
    };
    void upload.then(done, done);
  }, []);

  const settled = useCallback(async () => {
    while (pendingRef.current.size > 0) {
      await Promise.allSettled([...pendingRef.current]);
    }
  }, []);

  return useMemo(() => ({ isUploading: count > 0, track, settled }), [count, track, settled]);
}

const UploadTrackerContext = createContext<UploadTracker | null>(null);

export const UploadTrackerProvider = UploadTrackerContext.Provider;

/**
 * The tracker of the form this field sits in. Required: an upload field outside a provider
 * could not hold Save or be awaited, so its upload could be dropped; that is a wiring bug,
 * reported at once rather than left to a quick Save.
 */
export function useUploadTrackerContext(): UploadTracker {
  const tracker = useContext(UploadTrackerContext);
  if (!tracker) {
    throw new Error(
      "An upload field must sit inside an UploadTrackerProvider (features/website/shared/upload-tracker.tsx).",
    );
  }
  return tracker;
}

/** A form's submit handler that first waits for the tracker's uploads, then runs `handler`. */
export function submitAfterUploads(
  tracker: UploadTracker,
  handler: (event: SyntheticEvent) => void,
): (event: SyntheticEvent) => void {
  return (event) => {
    event.preventDefault();
    void tracker.settled().then(() => {
      handler(event);
    });
  };
}
