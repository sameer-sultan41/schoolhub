import { createHmac } from "node:crypto";
import { ApiClient } from "@schoolhub/api-client";
import { env } from "@/env";
import { E2E_PLATFORM_OPERATOR_EMAIL, E2E_PLATFORM_TOTP_KEY } from "@/lib/seed-constants";

const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;

/**
 * The RFC 6238 code for the raw HMAC `key` at `at` (HMAC-SHA1, 30-second steps, six digits),
 * the parameters `pyotp.TOTP` defaults to and `core/rbac/mfa.py` uses. The server stores the
 * key's base32 form; the bytes are the same.
 */
export function totpCode(key: string, at: Date = new Date()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at.getTime() / 1000 / TOTP_STEP_SECONDS)));
  const digest = createHmac("sha1", Buffer.from(key, "ascii")).update(counter).digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

interface MfaChallenge {
  mfa_required: true;
  mfa_token: string;
}

interface SignedIn {
  access_token: string;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${env.API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`live platform ${path} failed: ${response.status} ${await response.text()}`);
  }
  const { data } = (await response.json()) as { data: T };
  return data;
}

/**
 * The seeded platform operator, signed in the way the console requires: password, then a
 * TOTP code (`POST /auth/login` answers a challenge, `POST /auth/mfa:verify` completes it).
 * The token carries `amr: ["pwd", "otp"]`, which `/platform/*` routes require.
 *
 * Costs two auth-throttled requests and no refresh: a spec makes one of these and keeps it
 * for its whole run, well inside the access token's lifetime. A code is accepted once per
 * 30-second step (`mfa_last_timecode`), so a retry inside the same step would be refused.
 */
export async function createPlatformLiveSession(): Promise<ApiClient> {
  const challenge = await postJson<MfaChallenge>("/auth/login", {
    identifier: E2E_PLATFORM_OPERATOR_EMAIL,
    password: env.LIVE_ADMIN_PASSWORD,
  });
  const { access_token: accessToken } = await postJson<SignedIn>("/auth/mfa:verify", {
    mfa_token: challenge.mfa_token,
    code: totpCode(E2E_PLATFORM_TOTP_KEY),
  });
  return new ApiClient({
    baseUrl: env.API_BASE_URL,
    fetchImpl: fetch,
    getAccessToken: () => accessToken,
  });
}
