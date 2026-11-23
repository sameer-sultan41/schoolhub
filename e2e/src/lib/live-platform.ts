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

function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${env.API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function dataOf<T>(path: string, response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`live platform ${path} failed: ${response.status} ${await response.text()}`);
  }
  const { data } = (await response.json()) as { data: T };
  return data;
}

async function isInvalidCode(response: Response): Promise<boolean> {
  if (response.status !== 400) return false;
  const body = (await response.clone().json()) as { error?: { code?: string } };
  return body.error?.code === "invalid_mfa_code";
}

/** Milliseconds until the next 30-second TOTP step starts, plus a small margin. */
function untilNextStep(): number {
  const stepMs = TOTP_STEP_SECONDS * 1000;
  return stepMs - (Date.now() % stepMs) + 250;
}

/**
 * The seeded platform operator, signed in the way the console requires: password, then a
 * TOTP code (`POST /auth/login` answers a challenge, `POST /auth/mfa:verify` completes it).
 * The token carries `amr: ["pwd", "otp"]`, which `/platform/*` routes require.
 *
 * A code is accepted once per 30-second step (`mfa_last_timecode`), so a spec signing in
 * within the same step as another is refused `invalid_mfa_code`; it then waits for the next
 * step and retries once on the same challenge. Costs two or three auth-throttled requests and
 * no refresh: a spec keeps the session for its whole run, well inside the token's lifetime.
 */
export async function createPlatformLiveSession(): Promise<ApiClient> {
  const challenge = await dataOf<MfaChallenge>(
    "/auth/login",
    await post("/auth/login", {
      identifier: E2E_PLATFORM_OPERATOR_EMAIL,
      password: env.LIVE_ADMIN_PASSWORD,
    }),
  );
  const verify = () =>
    post("/auth/mfa:verify", {
      mfa_token: challenge.mfa_token,
      code: totpCode(E2E_PLATFORM_TOTP_KEY),
    });
  let response = await verify();
  if (await isInvalidCode(response)) {
    await new Promise((resolve) => setTimeout(resolve, untilNextStep()));
    response = await verify();
  }
  const { access_token: accessToken } = await dataOf<SignedIn>("/auth/mfa:verify", response);
  return new ApiClient({
    baseUrl: env.API_BASE_URL,
    fetchImpl: fetch,
    getAccessToken: () => accessToken,
  });
}
