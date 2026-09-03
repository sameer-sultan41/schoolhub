import { ApiError } from "@schoolhub/api-client";
import { buildLiveHouse } from "@/data/live-factories";
import { expect, test } from "@/fixtures";

/**
 * Live API lane — no browser, no UI. See campuses.spec.ts's header comment for the shared
 * rationale (real HTTP contract only; field validation stays at the Django unit level).
 */
test.describe("houses (live API)", () => {
  test("supports the full create/read/update/delete lifecycle", async ({ liveApiClient }) => {
    const created = await liveApiClient.post("/houses", buildLiveHouse());
    expect(created.status).toBe(201);
    const house = created.data as { id: string; code: string };

    const listed = await liveApiClient.get<Array<{ id: string }>>("/houses");
    expect(listed.data.some((row) => row.id === house.id)).toBe(true);

    const updated = await liveApiClient.patch(`/houses/${house.id}`, { motto: "Onward" });
    expect((updated.data as { motto: string }).motto).toBe("Onward");

    const deleted = await liveApiClient.delete(`/houses/${house.id}`);
    expect(deleted.status).toBe(204);

    const afterDelete = await liveApiClient
      .get(`/houses/${house.id}`)
      .catch((error: unknown) => error);
    expect(afterDelete).toBeInstanceOf(ApiError);
    expect((afterDelete as ApiError).status).toBe(404);
  });
});
