// Deliberate violations to prove the lint ratchet fails CI (scratch branch; never merged).
import { ApiError } from "@schoolhub/api-client";
import { env } from "../../lib/env";

export function RatchetProbe() {
  const origin = process.env.NEXT_PUBLIC_APP_URL;
  return (
    <div className="ml-2">
      Untranslated text {origin} {env.NEXT_PUBLIC_API_BASE_URL} {String(ApiError)}
    </div>
  );
}
