import type { ApiClient } from "@schoolhub/api-client";
import { env } from "@/env";
import { expect, test } from "@/fixtures";
import { createLiveSession } from "@/lib/live-api";
import { FAKE_SIGNATURE_HEADER, seedIssuedInvoice, signFakeCallback } from "@/lib/live-fees";
import { linkSeededGuardian } from "@/lib/live-guardian";
import { E2E_GUARDIAN_EMAIL } from "@/lib/seed-constants";

/**
 * Live API lane — no browser. See campuses.spec.ts's header for the shared rationale.
 *
 * Online fee payments end to end against the **fake** provider (ADR-0034): an admin saves the
 * school's gateway account, the seeded guardian (holding `fees.payment.pay-online`, linked to
 * this run's own child) starts a checkout, and the spec plays the provider, signing and posting
 * the callback exactly as `FakeAdapter.verify_callback` checks it. What only a real stack can
 * prove: the public route resolves the tenant from the slug with no session, the signature is
 * checked against the secret stored encrypted in the database, the payment confirms with a
 * receipt and ledger postings under RLS, a replayed callback changes nothing, and the same
 * token under another school's slug is a 404.
 *
 * The callback's re-fetch is satisfied because the dev stack runs with
 * `PAYMENT_FAKE_SETTLES_ON_INITIATE`: the fake records the checkout as paid when it starts.
 * The re-fetch's own rules (an unknown or mismatched transaction confirms nothing) are pinned in
 * `apps/api/apps/fees_finance/tests/test_payment_callback.py`.
 *
 * Endpoints covered: `PUT /payment-gateway-accounts/current`,
 * `POST /fee-invoices/{id}:initiate-payment`, `POST /public/payment-callbacks/{slug}/{token}`.
 */

interface GatewayAccount {
  provider: string;
  is_active: boolean;
  merchant_id_masked: string;
  callback_url: string;
}

interface Payment {
  id: string;
  status: string;
  amount: string;
  reference_no: string;
  receipt_no: string | null;
}

async function postCallback(url: string, body: string, signature: string): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", [FAKE_SIGNATURE_HEADER]: signature },
    body,
  });
}

async function guardianSession(): Promise<ApiClient> {
  return createLiveSession({ identifier: E2E_GUARDIAN_EMAIL, password: env.LIVE_ADMIN_PASSWORD });
}

test.describe("online fee payments (live API, fake provider)", () => {
  test("a signed callback confirms the payment once, and only for its own school", async ({
    liveApiClient,
  }) => {
    // A secret for this run only: saving the same provider updates the account in place.
    const secret = crypto.randomUUID();
    const saved = await liveApiClient.put("/payment-gateway-accounts/current", {
      provider: "fake",
      credentials: { merchant_id: "E2E-MERCHANT-0001", secret },
      is_active: true,
    });
    const account = saved.data as GatewayAccount;
    expect(account).toMatchObject({ provider: "fake", is_active: true });
    // Write-only: the response carries a mask, never the credentials.
    expect(JSON.stringify(account)).not.toContain(secret);
    expect(account.callback_url).toContain(`/public/payment-callbacks/${env.LIVE_TENANT_SLUG}/`);
    // The URL's host is the API's configured public URL (API_PUBLIC_URL), which a provider
    // reaches; the spec posts the same path to the API it already talks to.
    const callbackUrl = new URL(
      new URL(account.callback_url).pathname,
      env.API_BASE_URL,
    ).toString();

    const invoice = await seedIssuedInvoice(liveApiClient);
    await linkSeededGuardian(liveApiClient, invoice.studentId);
    const guardian = await guardianSession();

    const initiated = await guardian.post(
      `/fee-invoices/${invoice.invoiceId}:initiate-payment`,
      { return_path: "/portal/fees" },
      { idempotencyKey: crypto.randomUUID() },
    );
    const { payment_id: paymentId, redirect_url: redirectUrl } = initiated.data as {
      payment_id: string;
      redirect_url: string;
    };
    expect(redirectUrl).toBeTruthy();

    const pending = (await liveApiClient.get<Payment>(`/payments/${paymentId}`)).data;
    expect(pending).toMatchObject({ status: "pending", amount: invoice.amount });

    const body = JSON.stringify({
      order_id: pending.reference_no,
      provider_txn_id: `E2E-${pending.reference_no}`,
      status: "paid",
      amount: invoice.amount,
      occurred_at: new Date().toISOString(),
    });
    const signature = await signFakeCallback(secret, body);

    const delivered = await postCallback(callbackUrl, body, signature);
    expect(delivered.status).toBe(200);
    expect(await delivered.json()).toMatchObject({ data: { received: true } });

    const confirmed = (await liveApiClient.get<Payment>(`/payments/${paymentId}`)).data;
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.receipt_no).toBeTruthy();
    const paidInvoice = await liveApiClient.get<{ status: string }>(
      `/fee-invoices/${invoice.invoiceId}`,
    );
    expect(paidInvoice.data.status).toBe("paid");
    const receipts = await liveApiClient.get<unknown[]>("/receipts", {
      query: { payment: paymentId },
    });
    expect(receipts.data).toHaveLength(1);
    const ledgerQuery = { query: { reference_type: "payment", reference_id: paymentId } };
    const postings = await liveApiClient.get<unknown[]>("/ledger-entries", ledgerQuery);
    expect(postings.data.length).toBeGreaterThan(0);

    // A replay of the same signed callback is acknowledged and changes nothing.
    const replayed = await postCallback(callbackUrl, body, signature);
    expect(replayed.status).toBe(200);
    expect(
      (await liveApiClient.get<unknown[]>("/receipts", { query: { payment: paymentId } })).data,
    ).toHaveLength(1);
    expect((await liveApiClient.get<unknown[]>("/ledger-entries", ledgerQuery)).data).toHaveLength(
      postings.data.length,
    );

    // The same token under another school's slug resolves nothing there.
    const foreignUrl = callbackUrl.replace(
      `/payment-callbacks/${env.LIVE_TENANT_SLUG}/`,
      `/payment-callbacks/${env.LIVE_OTHER_TENANT_SLUG}/`,
    );
    const foreign = await postCallback(foreignUrl, body, signature);
    expect(foreign.status).toBe(404);
  });
});
