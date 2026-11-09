import { ApiError, type ApiClient } from "@schoolhub/api-client";
import { expect } from "@/fixtures";
import { env } from "@/env";
import { createLiveSession } from "@/lib/live-api";
import {
  E2E_ACCOUNTANT_EMAIL,
  E2E_FINANCE_FEE_HEAD_CODE,
  E2E_FINANCE_STAFF_EMAIL,
} from "@/lib/seed-constants";

/** What the fees live specs share: the seeded `accountant`'s session, a refusal's `ApiError`, and
 * the seeded fee head. */

interface Identified {
  id: string;
}

/** The seeded `accountant`, one login per worker (`AuthEndpointThrottle`, e2e/AGENTS.md). A failed
 * login is forgotten, so it does not fail every later test with the same cached rejection. */
let accountantLogin: Promise<ApiClient> | undefined;
export function accountantSession(): Promise<ApiClient> {
  accountantLogin ??= createLiveSession({
    identifier: E2E_ACCOUNTANT_EMAIL,
    // Every seeded e2e login shares the admin's password (seed_e2e_data.py).
    password: env.LIVE_ADMIN_PASSWORD,
  }).catch((error: unknown) => {
    accountantLogin = undefined;
    throw error;
  });
  return accountantLogin;
}

/** The seeded `finance_staff` (the counter's role), one login per worker like the accountant's. */
let financeStaffLogin: Promise<ApiClient> | undefined;
export function financeStaffSession(): Promise<ApiClient> {
  financeStaffLogin ??= createLiveSession({
    identifier: E2E_FINANCE_STAFF_EMAIL,
    password: env.LIVE_ADMIN_PASSWORD,
  }).catch((error: unknown) => {
    financeStaffLogin = undefined;
    throw error;
  });
  return financeStaffLogin;
}

/** The `ApiError` a request is refused with: fails the test if it succeeds or fails otherwise. */
export async function refusal(request: Promise<unknown>): Promise<ApiError> {
  const outcome = await request.catch((error: unknown) => error);
  expect(outcome).toBeInstanceOf(ApiError);
  return outcome as ApiError;
}

/** The seeded fee head's id (`seed_e2e_fees`), a head any spec may schedule against. */
export async function seededHeadId(accountant: ApiClient): Promise<string> {
  const heads = await accountant.get<(Identified & { code: string })[]>("/fee-heads", {
    query: { search: E2E_FINANCE_FEE_HEAD_CODE },
  });
  const head = heads.data.find((row) => row.code === E2E_FINANCE_FEE_HEAD_CODE);
  if (!head) throw new Error("the seeded fee head is missing — run manage.py seed_e2e_fees");
  return head.id;
}
