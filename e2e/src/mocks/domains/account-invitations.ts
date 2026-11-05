import { fail, noContent, ok } from "../envelope";
import type { MockModule } from "../router";

/** `POST /auth/invitations:preview`'s body (`InvitationPreviewSerializer`). */
export interface InvitationPreview {
  email: string;
  school_name: string;
  expires_at: string;
}

/** What the stubs received, for a spec to assert the request bodies on. */
export interface AccountRequests {
  accepted: unknown[];
  resetRequested: unknown[];
  resetConfirmed: unknown[];
}

export interface AccountInvitationsOptions {
  /** The one link the stubs accept; any other school, token or uid is `invalid_link`. */
  school?: string;
  token?: string;
  uid?: string;
  preview?: InvitationPreview;
  received?: AccountRequests;
}

export function emptyAccountRequests(): AccountRequests {
  return { accepted: [], resetRequested: [], resetConfirmed: [] };
}

export function buildInvitationPreview(
  overrides: Partial<InvitationPreview> = {},
): InvitationPreview {
  return {
    email: "parent@example.com",
    school_name: "City School",
    expires_at: "2026-11-12T10:00:00Z",
    ...overrides,
  };
}

/** `MinimumLengthValidator`'s `min_length` (`apps/api/config/settings/base.py`). */
const PASSWORD_MIN_LENGTH = 10;

/**
 * The emailed-link endpoints (ADR-0033): invitation preview and accept, reset request and
 * confirm. Modelled on the real views: every unusable link is one 400 `invalid_link` with
 * one message, a short password is a 400 `validation_error` on the password field, and a
 * reset request is a `204` whatever the email.
 */
export function accountInvitationsModule(options: AccountInvitationsOptions = {}): MockModule {
  const school = options.school ?? "city";
  const token = options.token ?? "e2e-token";
  const uid = options.uid ?? "e2e-uid";
  const preview = options.preview ?? buildInvitationPreview();
  const received = options.received ?? emptyAccountRequests();
  const invalidLink = () =>
    fail(400, "This link is invalid or has expired.", { code: "invalid_link" });
  // Django's `MinimumLengthValidator` message for PASSWORD_MIN_LENGTH.
  const tooShort = "This password is too short. It must contain at least 10 characters.";
  const weakPassword = (field: string) =>
    fail(400, "Invalid input.", { details: [{ field, issue: tooShort }] });

  return (api) => {
    // `:invitationAction` captures the colon action itself (":preview", ":accept").
    api.post("/auth/invitations:invitationAction", (request) => {
      const body = (request.json() as Record<string, string> | null) ?? {};
      if (body["school"] !== school || body["token"] !== token) return invalidLink();
      const action = request.params["invitationAction"];
      if (action === ":preview") return ok(preview);
      if (action !== ":accept") return fail(404, "Not found.");
      if ((body["password"] ?? "").length < PASSWORD_MIN_LENGTH) return weakPassword("password");
      received.accepted.push(body);
      return noContent();
    });

    api.post("/auth/password-reset", (request) => {
      received.resetRequested.push(request.json());
      return noContent();
    });

    api.post("/auth/password-reset:resetAction", (request) => {
      if (request.params["resetAction"] !== ":confirm") return fail(404, "Not found.");
      const body = (request.json() as Record<string, string> | null) ?? {};
      if (body["school"] !== school || body["uid"] !== uid || body["token"] !== token) {
        return invalidLink();
      }
      if ((body["new_password"] ?? "").length < PASSWORD_MIN_LENGTH) {
        return weakPassword("new_password");
      }
      received.resetConfirmed.push(body);
      return noContent();
    });
  };
}
