import { buildLiveHouse } from "@/data/live-factories";
import { expect, test } from "@/fixtures";
import { runCrudLifecycle } from "@/lib/live-crud-lifecycle";

interface House {
  id: string;
  code: string;
  motto: string;
}

/**
 * Live API lane — no browser, no UI. See campuses.spec.ts's header comment for the shared
 * rationale (real HTTP contract only; field validation stays at the Django unit level).
 */
test.describe("houses (live API)", () => {
  test("supports the full create/read/update/delete lifecycle", async ({ liveApiClient }) => {
    await runCrudLifecycle<House>({
      liveApiClient,
      endpoint: "/houses",
      build: buildLiveHouse,
      patch: { motto: "Onward" },
      assertPatched: (house) => {
        expect(house.motto).toBe("Onward");
      },
    });
  });
});
