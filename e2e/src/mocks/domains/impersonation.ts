import type { ApiSchemas } from "@schoolhub/api-client";
import type { AuthenticatedUser } from "@schoolhub/types";
import { dashboardTenantOrigin } from "@/env";
import { fail, noContent, ok } from "../envelope";
import type { MockModule } from "../router";

/** The single-use code `:impersonate` hands out, carried in the handoff link's fragment. */
export const HANDOFF_CODE = "e2e-handoff-code";
/** How long the grant this mock starts runs (`expires_in` on the exchange). */
const GRANT_SECONDS = 30 * 60;

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** The exchange's access token. Unsigned: the dashboard reads `amr` from it and never verifies;
 * the API does (`core/rbac/authentication.py`). Claims as ADR-0037 lists them. */
export const IMPERSONATION_TOKEN = [
  base64url({ alg: "HS256", typ: "JWT" }),
  base64url({
    token_type: "access",
    sub: "target",
    act: { sub: "operator" },
    grant_id: "e2e-grant",
    amr: ["impersonation"],
  }),
  "e2e-signature",
].join(".");

/** `POST /platform/tenants/{id}:impersonate`'s answer: the grant and the school's handoff link. */
export function grantStarted(slug: string): ApiSchemas["GrantStarted"] {
  return {
    grant_id: "8a9b0c1d-2e3f-4a5b-8c7d-6e5f4a3b2c1d",
    expires_at: new Date(Date.now() + GRANT_SECONDS * 1000).toISOString(),
    handoff_url: `${dashboardTenantOrigin(slug)}/impersonate#school=${slug}&code=${HANDOFF_CODE}`,
  };
}

export interface ImpersonationModuleOptions {
  /** Who `/auth/me` is for a normal session: the operator signed in on the console. */
  operator: AuthenticatedUser;
  /** Who the impersonated session is (`/auth/me` under the exchange's token). */
  target: AuthenticatedUser;
  operatorName: string;
}

/**
 * `/auth/impersonation:exchange`, `/auth/impersonation:end` and `/auth/me` for both sessions
 * (`apps/api/apps/platform_admin/impersonation/view.py`). Stateful: the code is single use, and
 * after `:end` the token is refused 401 `impersonation_ended`, as the grant check refuses it.
 * Register it after `authModule`: its `/auth/me` replaces that module's.
 */
export function impersonationModule(options: ImpersonationModuleOptions): MockModule {
  return (api) => {
    let codeSpent = false;
    let ended = false;
    let expiresAt = "";

    // The router turns `:action` into `([^/]+)`, which captures the colon too.
    api.post("/auth/impersonation:action", (request) => {
      const action = request.params["action"]?.replace(/^:/, "");
      if (action === "exchange") {
        const body = request.json() as { code?: string } | null;
        if (body?.code !== HANDOFF_CODE || codeSpent) {
          return fail(400, "This link is no longer valid.", { code: "invalid_link" });
        }
        codeSpent = true;
        expiresAt = new Date(Date.now() + GRANT_SECONDS * 1000).toISOString();
        return ok<ApiSchemas["ExchangeResponse"]>({
          access: IMPERSONATION_TOKEN,
          expires_in: GRANT_SECONDS,
        });
      }
      if (action === "end") {
        if (ended) {
          return fail(401, "This support session has ended.", { code: "impersonation_ended" });
        }
        ended = true;
        return noContent();
      }
      return fail(404, "Not found.");
    });

    api.get("/auth/me", (request) => {
      if (request.headers["authorization"] !== `Bearer ${IMPERSONATION_TOKEN}`) {
        return ok(options.operator);
      }
      if (ended) {
        return fail(401, "This support session has ended.", { code: "impersonation_ended" });
      }
      return ok({
        ...options.target,
        impersonation: { by_name: options.operatorName, expires_at: expiresAt },
      });
    });
  };
}
