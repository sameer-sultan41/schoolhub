import type {
  AuthenticatedUser,
  LoginCredentials,
  MfaChallengeResponse,
  RefreshResponse,
} from "@schoolhub/types";
import { buildLoginResponse, buildUser } from "@/data/factories";
import { fail, noContent, ok } from "../envelope";
import type { MockModule } from "../router";

export interface AuthModuleOptions {
  /** The signed-in user `/auth/me` and `/auth/login` resolve to. */
  user?: AuthenticatedUser;
  /** Credentials that succeed. Anything else gets the API's real 401 envelope. */
  credentials?: LoginCredentials;
  /** Start signed out: `/auth/me` and `/auth/refresh` 401 until a successful login. */
  signedOut?: boolean;
  /** The account has TOTP on: login answers a challenge, and `/auth/mfa:verify` takes this
   * code (`core/rbac/views.py`'s `LoginView`/`MfaVerifyView`). */
  mfaCode?: string;
}

const MFA_TOKEN = "e2e-mfa-challenge";

/**
 * `/auth/*` — login, session restore, refresh rotation, logout.
 *
 * Models the real state machine rather than returning a fixed 200: the access token is
 * short-lived and in memory only, so a cold load calls `/auth/refresh` before `/auth/me`
 * (see `apps/dashboard/src/lib/auth.ts`). Tests that assert on session restore depend on
 * that ordering being reproduced faithfully.
 */
export function authModule(options: AuthModuleOptions = {}): MockModule {
  const user = options.user ?? buildUser();
  const credentials = options.credentials ?? {
    identifier: "admin@cityschool.test",
    password: "correct-horse-battery-staple",
  };

  return (api) => {
    let signedIn = !options.signedOut;
    let refreshCount = 0;

    api.post("/auth/login", (request) => {
      const body = request.json() as LoginCredentials | null;
      if (body?.identifier !== credentials.identifier || body.password !== credentials.password) {
        // The real API returns a deliberately vague 401 so it cannot be used to
        // enumerate which identifiers exist.
        return fail(401, "Incorrect email/phone or password.");
      }
      if (options.mfaCode !== undefined) {
        // A challenge, not a session: no token, no cookie, no user.
        return ok<MfaChallengeResponse>({ mfa_required: true, mfa_token: MFA_TOKEN });
      }
      signedIn = true;
      return ok(buildLoginResponse({ user }));
    });

    // `POST /auth/mfa:verify`. The router turns `:action` into `([^/]+)`, which captures the
    // colon too, so the parameter reads `:verify`.
    api.post("/auth/mfa:action", (request) => {
      if (request.params["action"]?.replace(/^:/, "") !== "verify") {
        return fail(404, "Not found.");
      }
      const body = request.json() as { mfa_token?: string; code?: string } | null;
      if (body?.mfa_token !== MFA_TOKEN) {
        return fail(400, "This sign-in has expired. Sign in again.", {
          code: "mfa_challenge_invalid",
        });
      }
      if (body.code !== options.mfaCode) {
        // 400, not 401: a wrong code must never look like a dead session.
        return fail(400, "That code is not valid.", { code: "invalid_mfa_code" });
      }
      signedIn = true;
      return ok(buildLoginResponse({ user }));
    });

    api.post("/auth/refresh", () => {
      if (!signedIn) return fail(401, "Refresh token is missing or expired.");
      refreshCount += 1;
      // Rotating token: a new value every time, so a replayed old one is detectable.
      return ok<RefreshResponse>({
        access_token: `e2e-access-token-${refreshCount}`,
        expires_in: 900,
      });
    });

    api.get("/auth/me", () => {
      if (!signedIn) return fail(401, "Authentication credentials were not provided.");
      return ok(user);
    });

    api.post("/auth/logout", () => {
      signedIn = false;
      return noContent();
    });
  };
}
