import { ApiError } from "@schoolhub/api-client";
import { buildLiveDepartment } from "@/data/live-factories";
import { expect, test } from "@/fixtures";

/**
 * Live API lane — no browser, no UI. See campuses.spec.ts's header comment for the shared
 * rationale (real HTTP contract only; field validation stays at the Django unit level).
 */
test.describe("departments (live API)", () => {
  test("supports the full create/read/update/delete lifecycle", async ({ liveApiClient }) => {
    const created = await liveApiClient.post("/departments", buildLiveDepartment());
    expect(created.status).toBe(201);
    const department = created.data as { id: string; code: string };

    const listed = await liveApiClient.get<Array<{ id: string }>>("/departments");
    expect(listed.data.some((row) => row.id === department.id)).toBe(true);

    const updated = await liveApiClient.patch(`/departments/${department.id}`, {
      name: "Renamed",
    });
    expect((updated.data as { name: string }).name).toBe("Renamed");

    const deleted = await liveApiClient.delete(`/departments/${department.id}`);
    expect(deleted.status).toBe(204);

    const afterDelete = await liveApiClient
      .get(`/departments/${department.id}`)
      .catch((error: unknown) => error);
    expect(afterDelete).toBeInstanceOf(ApiError);
    expect((afterDelete as ApiError).status).toBe(404);
  });
});
