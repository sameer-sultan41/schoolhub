import { buildLiveDepartment } from "@/data/live-factories";
import { expect, test } from "@/fixtures";
import { runCrudLifecycle } from "@/lib/live-crud-lifecycle";

interface Department {
  id: string;
  code: string;
  name: string;
}

/**
 * Live API lane — no browser, no UI. See campuses.spec.ts's header comment for the shared
 * rationale (real HTTP contract only; field validation stays at the Django unit level).
 */
test.describe("departments (live API)", () => {
  test("supports the full create/read/update/delete lifecycle", async ({ liveApiClient }) => {
    await runCrudLifecycle<Department>({
      liveApiClient,
      endpoint: "/departments",
      build: buildLiveDepartment,
      patch: { name: "Renamed" },
      assertPatched: (department) => {
        expect(department.name).toBe("Renamed");
      },
    });
  });
});
