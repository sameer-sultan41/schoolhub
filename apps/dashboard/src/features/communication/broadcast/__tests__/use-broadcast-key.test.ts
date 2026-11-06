import { renderHook } from "@testing-library/react";

import { broadcastSignature, useBroadcastKey } from "../use-broadcast-key";

const BASE = { audience_type: "staff", message: "School is closed." } as const;

describe("useBroadcastKey", () => {
  it("reuses the key for the same request and preview", () => {
    const { result } = renderHook(() => useBroadcastKey());
    const signature = broadcastSignature(BASE, 3, "digest-1");

    expect(result.current.keyFor(signature)).toBe(result.current.keyFor(signature));
  });

  it("mints a new key when the message, the audience or the preview changes", () => {
    const { result } = renderHook(() => useBroadcastKey());
    const first = result.current.keyFor(broadcastSignature(BASE, 3, "digest-1"));

    const message = result.current.keyFor(
      broadcastSignature({ ...BASE, message: "School opens at noon." }, 3, "digest-1"),
    );
    const audience = result.current.keyFor(
      broadcastSignature({ ...BASE, audience_type: "all" }, 3, "digest-1"),
    );
    const digest = result.current.keyFor(
      broadcastSignature({ ...BASE, audience_type: "all" }, 4, "digest-2"),
    );

    expect(new Set([first, message, audience, digest]).size).toBe(4);
  });

  it("mints a new key after forget", () => {
    const { result } = renderHook(() => useBroadcastKey());
    const signature = broadcastSignature(BASE, 3, "digest-1");
    const first = result.current.keyFor(signature);

    result.current.forget();

    expect(result.current.keyFor(signature)).not.toBe(first);
  });
});
