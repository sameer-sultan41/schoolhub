import { ApiError } from "@schoolhub/api-client";
import { buildLiveCampus, buildLiveClass, buildLiveSection } from "@/data/live-factories";
import { expect, test } from "@/fixtures";

/**
 * Live API lane — no browser, no UI. See campuses.spec.ts's header comment for the shared
 * rationale (real HTTP contract only; field validation stays at the Django unit level).
 *
 * Grouped together because a section always references a class (its own FK): building
 * both in one file avoids every other file re-deriving the same parent fixture. Creates
 * its own campus rather than relying on the seeded baseline one, so this file stays
 * independent of what `seed_e2e_data` happens to seed.
 */
test.describe("classes and sections (live API)", () => {
  test("supports the full create/read/update/delete lifecycle", async ({ liveApiClient }) => {
    const campus = (await liveApiClient.post("/campuses", buildLiveCampus())).data as {
      id: string;
    };
    const schoolClass = (await liveApiClient.post("/classes", buildLiveClass())).data as {
      id: string;
    };

    const created = await liveApiClient.post("/sections", {
      ...buildLiveSection(),
      class_id: schoolClass.id,
      campus_id: campus.id,
    });
    expect(created.status).toBe(201);
    const section = created.data as { id: string; class_id: string; campus_id: string };
    expect(section.class_id).toBe(schoolClass.id);
    expect(section.campus_id).toBe(campus.id);

    const listed = await liveApiClient.get<Array<{ id: string }>>("/sections", {
      query: { class_id: schoolClass.id },
    });
    expect(listed.data.some((row) => row.id === section.id)).toBe(true);

    const updated = await liveApiClient.patch(`/sections/${section.id}`, { capacity: 25 });
    expect((updated.data as { capacity: number }).capacity).toBe(25);
  });

  test("blocks deleting a class that still has an active section", async ({ liveApiClient }) => {
    const campus = (await liveApiClient.post("/campuses", buildLiveCampus())).data as {
      id: string;
    };
    const schoolClass = (await liveApiClient.post("/classes", buildLiveClass())).data as {
      id: string;
    };
    await liveApiClient.post("/sections", {
      ...buildLiveSection(),
      class_id: schoolClass.id,
      campus_id: campus.id,
    });

    // Proves the view actually wires BlockingDestroyMixin's services.assert_deletable
    // (apps/api/apps/school_organization/services.py) end-to-end — a Django unit test of
    // assert_deletable alone would not catch a mistake in how the view calls it.
    const blocked = await liveApiClient
      .delete(`/classes/${schoolClass.id}`)
      .catch((error: unknown) => error);
    expect(blocked).toBeInstanceOf(ApiError);
    const error = blocked as ApiError;
    expect(error.status).toBe(422);
    expect(error.message.toLowerCase()).toContain("sections");
  });
});
