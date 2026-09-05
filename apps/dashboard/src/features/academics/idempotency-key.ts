/**
 * A fresh `Idempotency-Key` for the two academics endpoints that accept one
 * (`POST /class-subjects:clone` and `POST /student-promotions/{id}:execute` —
 * both wrap their work in `core.idempotency.services.replay_or_execute`).
 *
 * Minted once per user intent, not once per request: the key's job is to make a
 * retry after a timeout replay the first result instead of running the work
 * twice, so the retry has to carry the *same* key the original did.
 *
 * `crypto.randomUUID` is available in every browser this app supports; the
 * fallback exists because it is absent from insecure (non-HTTPS, non-localhost)
 * origins, where a missing key would silently turn a retry into a second
 * execution.
 */
export function newIdempotencyKey(): string {
  // Cast, not an annotation: the DOM lib declares `crypto` non-optional, so
  // without this the guard below is flagged as an unnecessary condition even
  // though it is exactly what an insecure origin needs.
  const webCrypto = globalThis.crypto as Crypto | undefined;
  if (typeof webCrypto?.randomUUID === "function") return webCrypto.randomUUID();
  return `sh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
