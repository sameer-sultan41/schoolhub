import { newIdempotencyKey } from "@/features/academics/idempotency-key";

describe("newIdempotencyKey", () => {
  const realCrypto = globalThis.crypto;

  afterEach(() => {
    Object.defineProperty(globalThis, "crypto", { value: realCrypto, configurable: true });
  });

  it("uses crypto.randomUUID when it is available", () => {
    Object.defineProperty(globalThis, "crypto", {
      value: { randomUUID: () => "11111111-2222-3333-4444-555555555555" },
      configurable: true,
    });

    expect(newIdempotencyKey()).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("falls back to a locally generated key on an origin without randomUUID", () => {
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });

    const key = newIdempotencyKey();
    expect(key).toMatch(/^sh-[a-z0-9]+-[a-z0-9]+$/);
    expect(key).not.toBe(newIdempotencyKey());
  });
});
