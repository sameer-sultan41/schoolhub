import { randomUUID } from "node:crypto";
import type { ApiClient } from "@schoolhub/api-client";
import { expect, test } from "@/fixtures";
import { buildLiveAcademicSession, buildLiveClass } from "@/data/live-factories";
import { accountantSession, refusal, seededHeadId } from "@/lib/live-fees";

/**
 * Live API lane — no browser. See campuses.spec.ts's header for the shared rationale.
 *
 * Fees setup (PR A): a fee structure's lifecycle against the real API, as the seeded `accountant`
 * (so the real role's keys are what is exercised: `fees.fee-structure.create|update` and the
 * ledger reads), on a run-unique session and class that no other spec or worker shares. Field
 * validation stays in the Django suite (`apps/api/apps/fees_finance/tests/`); this lane pins what
 * only a real stack shows: the activate refusals the dashboard shows inline, and RLS.
 *
 * The seeded draft ("E2E Draft Fees", on the second campus) is not activated here: a second
 * activation would fail on the next rerun against the same database. Each test builds its own
 * structure instead.
 *
 * Endpoints covered: `GET /fee-heads`, `POST /fee-structures`, `GET /fee-structures/{id}`,
 * `POST /fee-structures/{id}:activate`, `:archive`, `POST /fee-schedules`.
 */

interface Identified {
  id: string;
}

interface FeeStructure {
  id: string;
  name: string;
  status: string;
  schedules: { id: string }[];
}

/** A run-unique session and class: a scope no other structure holds, so activation is free. */
async function freshScope(admin: ApiClient) {
  const [session, schoolClass] = await Promise.all([
    admin.post("/academic-sessions", buildLiveAcademicSession()).then((r) => r.data as Identified),
    admin.post("/classes", buildLiveClass()).then((r) => r.data as Identified),
  ]);
  return { academic_session: session.id, school_class: schoolClass.id };
}

function structureName(label: string): string {
  return `E2E ${label} ${randomUUID().slice(0, 8)}`;
}

async function createStructure(
  accountant: ApiClient,
  scope: { academic_session: string; school_class: string },
  name: string,
): Promise<FeeStructure> {
  const created = await accountant.post<FeeStructure>("/fee-structures", { name, ...scope });
  expect(created.status).toBe(201);
  return created.data;
}

async function addMonthlySchedule(accountant: ApiClient, structureId: string, headId: string) {
  return accountant.post("/fee-schedules", {
    fee_structure: structureId,
    fee_head: headId,
    amount: "1500.00",
    frequency: "monthly",
    due_day: 10,
  });
}

test.describe("fee structures (live API)", () => {
  test("the accountant builds a structure, is refused activating it empty, then activates it with a schedule", async ({
    liveApiClient,
  }) => {
    const accountant = await accountantSession();
    const scope = await freshScope(liveApiClient);
    const headId = await seededHeadId(accountant);

    const structure = await createStructure(accountant, scope, structureName("Fees"));
    // `status` and `schedules` are read-only: a new structure is a draft with no lines.
    expect(structure).toMatchObject({ status: "draft", schedules: [] });

    // No schedules: the refusal names `status`, the field the dashboard shows it under.
    const empty = await refusal(accountant.post(`/fee-structures/${structure.id}:activate`));
    expect(empty.status).toBe(422);
    expect(empty.details.map((detail) => detail.field)).toContain("status");

    // A monthly schedule needs its day of the month: a 400 under `due_day`, not a bare 409.
    const missingDay = await refusal(
      accountant.post("/fee-schedules", {
        fee_structure: structure.id,
        fee_head: headId,
        amount: "1500.00",
        frequency: "monthly",
      }),
    );
    expect(missingDay.status).toBe(400);
    expect(missingDay.details.map((detail) => detail.field)).toContain("due_day");

    expect((await addMonthlySchedule(accountant, structure.id, headId)).status).toBe(201);

    const activated = await accountant.post<FeeStructure>(
      `/fee-structures/${structure.id}:activate`,
    );
    expect(activated.status).toBe(200);
    expect(activated.data.status).toBe("active");

    // Active: its lines are fixed, a 422 under `fee_structure`.
    const fixed = await refusal(addMonthlySchedule(accountant, structure.id, headId));
    expect(fixed.status).toBe(422);
    expect(fixed.details.map((detail) => detail.field)).toContain("fee_structure");

    const read = (await accountant.get<FeeStructure>(`/fee-structures/${structure.id}`)).data;
    expect(read).toMatchObject({ status: "active" });
    expect(read.schedules).toHaveLength(1);
  });

  test("a second active structure at the same scope is a 422 until the first is archived", async ({
    liveApiClient,
  }) => {
    const accountant = await accountantSession();
    const scope = await freshScope(liveApiClient);
    const headId = await seededHeadId(accountant);

    const first = await createStructure(accountant, scope, structureName("First"));
    await addMonthlySchedule(accountant, first.id, headId);
    await accountant.post(`/fee-structures/${first.id}:activate`);

    const second = await createStructure(accountant, scope, structureName("Second"));
    await addMonthlySchedule(accountant, second.id, headId);
    const clash = await refusal(accountant.post(`/fee-structures/${second.id}:activate`));
    expect(clash.status).toBe(422);
    expect(clash.details.map((detail) => detail.field)).toContain("status");
    expect(clash.message).toContain(first.name);

    // The remedy the message names: archive the first, then the second activates.
    const archived = await accountant.post<FeeStructure>(`/fee-structures/${first.id}:archive`);
    expect(archived.data.status).toBe("archived");
    const activated = await accountant.post<FeeStructure>(`/fee-structures/${second.id}:activate`);
    expect(activated.data.status).toBe("active");
  });

  test("a structure of another tenant is a 404, never a 403", async ({
    liveApiClient,
    liveOtherTenantApiClient,
  }) => {
    const accountant = await accountantSession();
    const scope = await freshScope(liveApiClient);
    const structure = await createStructure(accountant, scope, structureName("Isolated"));

    try {
      // A real row and a real second identity: a 403 would confirm the row exists elsewhere.
      // The other tenant has `module.fees_finance` on (seed_e2e_data.py), so the feature gate
      // does not answer first.
      const read = await refusal(liveOtherTenantApiClient.get(`/fee-structures/${structure.id}`));
      expect(read.status).toBe(404);
      expect(read.code).toBe("not_found");
      const activate = await refusal(
        liveOtherTenantApiClient.post(`/fee-structures/${structure.id}:activate`),
      );
      expect(activate.status).toBe(404);
    } finally {
      await accountant.delete(`/fee-structures/${structure.id}`).catch(() => {});
    }
  });
});
