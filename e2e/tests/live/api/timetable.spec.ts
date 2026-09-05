import { ApiError, type ApiClient } from "@schoolhub/api-client";
import { buildLiveCampus, buildLivePeriod, buildLiveRoom } from "@/data/live-factories";
import { expect, test } from "@/fixtures";
import { runCrudLifecycle } from "@/lib/live-crud-lifecycle";
import {
  findSeededStaff,
  seedTimetableGrid,
  seedTimetableScaffold,
  type TimetableGrid,
} from "@/lib/live-timetable-grid";
import {
  E2E_BASELINE_FIRST_PERIOD_NAME,
  E2E_BASELINE_SUBSTITUTE_EMPLOYEE_NUMBER,
  E2E_BASELINE_SUBSTITUTION_REASON,
} from "@/lib/seed-constants";

/**
 * Live API lane — no browser. See campuses.spec.ts's header for the shared rationale
 * (real HTTP contract only; field-level validation stays at the Django level, here
 * `apps/api/apps/timetable/tests/`).
 *
 * Timetable is the most *stateful* module in the suite so far, and the tests below are
 * shaped by that rather than by the endpoint list:
 *
 * - **Publishing is destructive to the previous version.** `publish_section_timetable`
 *   end-dates every currently published slot of a section before promoting its drafts,
 *   so nothing here publishes into the seeded section — `seedTimetableGrid` builds a
 *   run-unique session/class/section per test (see its own header).
 * - **A draft is allowed to be wrong.** Every slot write saves *and* answers with
 *   `meta.conflicts` (§5.5), and only `:publish` refuses — so the conflict assertions
 *   below are on response bodies, never on a rejected write.
 * - **The seed owns the bell schedule and one proposed substitution.** Both are shared
 *   infrastructure a test reads rather than data it creates: periods cannot be
 *   duplicated per test without tripping the overlap rule, and the proposal exists so
 *   an isolation probe has a real, decidable row without paying for a full chain.
 *
 * Endpoints covered: `/rooms`, `/periods`, `/timetable-slots`,
 * `/teacher-substitutions` (list, retrieve, create), plus every colon-action —
 * `POST /timetables/{section_id}:validate`, `:publish`,
 * `POST /teacher-substitutions/{id}:approve`, `:reject`, and `GET /timetables/my`.
 */

interface Identified {
  id: string;
}

interface Room extends Identified {
  campus_id: string;
  code: string;
  capacity: number | null;
}

interface Period extends Identified {
  name: string;
  sequence: number;
  campus_id: string | null;
  is_break: boolean;
  weekdays: number[] | null;
}

interface Slot extends Identified {
  section_id: string;
  day_of_week: number;
  period_id: string;
  subject_id: string | null;
  staff_id: string | null;
  status: "draft" | "published";
  effective_from: string | null;
  effective_to: string | null;
  notes: string | null;
}

interface Conflict {
  type: string;
  severity: "hard" | "soft";
  slot_ids: string[];
  message: string;
}

interface Substitution extends Identified {
  timetable_slot_id: string;
  date: string;
  absent_staff_id: string;
  substitute_staff_id: string;
  reason: string | null;
  status: "proposed" | "confirmed" | "declined" | "completed" | "cancelled";
}

/**
 * The first date on or after `startDate` whose weekday is `dayOfWeek`.
 *
 * Two conversions that are easy to get wrong, both settled here rather than at each call
 * site: `day_of_week` is Monday-based (`services._slot_weekday`) while
 * `Date.getUTCDay()` is Sunday-based, and a date-only string must be read as UTC or a
 * machine behind UTC resolves the previous day. Because the offset is at most six days
 * and every generated session is 364 days long, the result is always inside the window
 * — which §11 also requires.
 */
function firstWeekdayOnOrAfter(startDate: string, dayOfWeek: number): string {
  const start = new Date(`${startDate}T00:00:00Z`);
  const startWeekday = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() + ((dayOfWeek - startWeekday + 7) % 7));
  return start.toISOString().slice(0, 10);
}

/** One draft cell of `grid`'s section. */
async function fillCell(
  client: ApiClient,
  grid: TimetableGrid,
  cell: { dayOfWeek: number; periodId: string; subjectId?: string | null; roomId?: string | null },
) {
  return client.post<Slot>("/timetable-slots", {
    academic_session_id: grid.sessionId,
    section_id: grid.sectionId,
    day_of_week: cell.dayOfWeek,
    period_id: cell.periodId,
    subject_id: cell.subjectId ?? null,
    staff_id: grid.teacherId,
    room_id: cell.roomId ?? null,
  });
}

function conflictTypes(conflicts: Conflict[] | undefined): Set<string> {
  return new Set((conflicts ?? []).map((conflict) => conflict.type));
}

test.describe("rooms (live API)", () => {
  test("supports the full create/read/update/delete lifecycle", async ({ liveApiClient }) => {
    const campus = (await liveApiClient.post("/campuses", buildLiveCampus())).data as Identified;

    await runCrudLifecycle<Room>({
      liveApiClient,
      endpoint: "/rooms",
      build: () => ({ ...buildLiveRoom(), campus_id: campus.id }),
      patch: { capacity: 12 },
      assertCreated: (room) => {
        expect(room.campus_id).toBe(campus.id);
      },
      assertListed: (listed) => {
        expect(listed.meta?.pagination).toBeDefined();
      },
      assertPatched: (room) => {
        expect(room.capacity).toBe(12);
      },
    });
  });

  test("a real room is 404 to another tenant's admin, never 403", async ({
    liveApiClient,
    liveOtherTenantApiClient,
  }) => {
    const campus = (await liveApiClient.post("/campuses", buildLiveCampus())).data as Identified;
    const room = (await liveApiClient.post("/rooms", { ...buildLiveRoom(), campus_id: campus.id }))
      .data as Room;

    try {
      // `module.timetable` is enabled on *both* tenants by the seed for exactly this
      // probe: `TenantScopedViewSetMixin` checks `required_feature` before
      // `required_permission`, so against a flag-disabled tenant this would answer 403
      // `module_disabled` and never reach the row lookup RLS is what proves.
      const probe = await liveOtherTenantApiClient
        .get(`/rooms/${room.id}`)
        .catch((error: unknown) => error);
      expect(probe).toBeInstanceOf(ApiError);
      expect((probe as ApiError).status).toBe(404);
      expect((probe as ApiError).code).toBe("not_found");
    } finally {
      await liveApiClient.delete(`/rooms/${room.id}`).catch(() => {});
    }
  });
});

test.describe("periods (live API)", () => {
  test("supports the full create/read/update/delete lifecycle", async ({ liveApiClient }) => {
    const campus = (await liveApiClient.post("/campuses", buildLiveCampus())).data as Identified;

    await runCrudLifecycle<Period>({
      liveApiClient,
      endpoint: "/periods",
      build: () => ({ ...buildLivePeriod(), campus_id: campus.id }),
      patch: { name: "Renamed period" },
      assertCreated: (period) => {
        expect(period.campus_id).toBe(campus.id);
        expect(period.is_break).toBe(false);
        // Null means "the tenant's working days" — the column is only ever written
        // when a period genuinely runs on a subset of the week.
        expect(period.weekdays).toBeNull();
      },
      assertPatched: (period) => {
        expect(period.name).toBe("Renamed period");
      },
    });
  });

  test("a period may not overlap a tenant-wide one, even on another campus", async ({
    liveApiClient,
  }) => {
    const campus = (await liveApiClient.post("/campuses", buildLiveCampus())).data as Identified;

    // §11's non-overlap rule is the reason the seeded bell schedule can be shared at
    // all: it is tenant-wide, so it applies to this brand-new campus too, and
    // `assert_period_does_not_overlap` compares against `campus_id = X OR campus_id IS
    // NULL` rather than only the campus's own rows. Without that, a campus period could
    // sit inside the school's own lunch break.
    const refused = await liveApiClient
      .post("/periods", {
        ...buildLivePeriod(),
        campus_id: campus.id,
        start_time: "08:15:00",
        end_time: "08:30:00",
      })
      .catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(ApiError);
    const error = refused as ApiError;
    expect(error.status).toBe(422);
    expect(error.code).toBe("domain_rule_violation");
    // The refusal names the clashing period, which is how a form tells the user what to
    // move — and here it is the seeded fixture, so this also pins that the seed really
    // did write a tenant-wide schedule rather than a campus-bound one.
    expect(error.fieldErrors().start_time).toContain(E2E_BASELINE_FIRST_PERIOD_NAME);
  });
});

test.describe("timetable-slots (live API)", () => {
  test("every write answers with the section's conflict list", async ({ liveApiClient }) => {
    const scaffold = await seedTimetableScaffold(liveApiClient);
    const period = scaffold.periods[0];
    if (!period) throw new Error("expected a seeded schedulable period");

    // A homeroom cell: neither subject nor teacher, which models.TimetableSlot's
    // nullable columns exist for and which no detector can fault.
    const created = await liveApiClient.post<Slot>("/timetable-slots", {
      academic_session_id: scaffold.sessionId,
      section_id: scaffold.sectionId,
      day_of_week: 0,
      period_id: period.id,
      notes: "Homeroom",
    });
    expect(created.status).toBe(201);
    const slot = created.data;
    expect(slot.status).toBe("draft");
    expect(slot.effective_from).toBeNull();
    // §16 wants the machine-readable list on *every* slot mutation, not only on the
    // ones that go wrong — a client re-renders its highlighting from this each time.
    expect(created.meta?.conflicts).toEqual([]);

    // The two filter names §16 spells differently from the columns: `weekday` is
    // `day_of_week` and `teacher_id` is `staff_id` (filters.py names them for the
    // tables they join to, not for the role the row plays).
    const listed = await liveApiClient.get<Slot[]>("/timetable-slots", {
      query: {
        academic_session_id: scaffold.sessionId,
        section_id: scaffold.sectionId,
        weekday: 0,
        status: "draft",
      },
    });
    expect(listed.data.map((row) => row.id)).toContain(slot.id);

    const patched = await liveApiClient.patch<Slot>(`/timetable-slots/${slot.id}`, {
      notes: "double period",
    });
    expect(patched.data.notes).toBe("double period");
    expect(patched.meta?.conflicts).toEqual([]);

    // 200 with a body, not 204: clearing a cell is the edit most likely to *resolve* a
    // clash the grid is still highlighting, so the remaining list comes back with it.
    const cleared = await liveApiClient.delete(`/timetable-slots/${slot.id}`);
    expect(cleared.status).toBe(200);
    expect(cleared.data).toBeNull();
    expect(cleared.meta?.conflicts).toEqual([]);

    const afterDelete = await liveApiClient
      .get(`/timetable-slots/${slot.id}`)
      .catch((error: unknown) => error);
    expect(afterDelete).toBeInstanceOf(ApiError);
    expect((afterDelete as ApiError).status).toBe(404);
  });

  test("a real slot is 404 to another tenant's admin, never 403", async ({
    liveApiClient,
    liveOtherTenantApiClient,
  }) => {
    const scaffold = await seedTimetableScaffold(liveApiClient);
    const period = scaffold.periods[0];
    if (!period) throw new Error("expected a seeded schedulable period");

    const slot = (
      await liveApiClient.post<Slot>("/timetable-slots", {
        academic_session_id: scaffold.sessionId,
        section_id: scaffold.sectionId,
        day_of_week: 2,
        period_id: period.id,
      })
    ).data;

    try {
      const probe = await liveOtherTenantApiClient
        .get(`/timetable-slots/${slot.id}`)
        .catch((error: unknown) => error);
      expect(probe).toBeInstanceOf(ApiError);
      expect((probe as ApiError).status).toBe(404);
      expect((probe as ApiError).code).toBe("not_found");
    } finally {
      await liveApiClient.delete(`/timetable-slots/${slot.id}`).catch(() => {});
    }
  });
});

test.describe("timetables :validate and :publish (live API)", () => {
  test("a hard conflict blocks publish until it is fixed, then the grid goes live", async ({
    liveApiClient,
  }) => {
    const grid = await seedTimetableGrid(liveApiClient);
    const period = grid.periods[0];
    if (!period) throw new Error("expected a seeded schedulable period");

    const clean = await fillCell(liveApiClient, grid, {
      dayOfWeek: 0,
      periodId: period.id,
      subjectId: grid.allocatedSubjectId,
      roomId: grid.roomId,
    });
    expect(clean.meta?.conflicts).toEqual([]);

    // The same teacher, a subject nobody allocated them to. §11 makes this *hard* —
    // scheduling it is the timetable contradicting academics, and examinations would
    // later derive marks-entry rights from an allocation that does not exist — but the
    // write still succeeds, because a grid mid-build has to stay savable (§5.5).
    const clashing = await fillCell(liveApiClient, grid, {
      dayOfWeek: 1,
      periodId: period.id,
      subjectId: grid.unallocatedSubjectId,
    });
    expect(clashing.status).toBe(201);
    expect(conflictTypes(clashing.meta?.conflicts as Conflict[])).toContain(
      "teacher_not_allocated",
    );

    const validated = await liveApiClient.post<{
      section_id: string;
      academic_session_id: string;
      conflicts: Conflict[];
      has_hard_conflicts: boolean;
    }>(`/timetables/${grid.sectionId}:validate`, { academic_session_id: grid.sessionId });
    expect(validated.status).toBe(200);
    expect(validated.data.section_id).toBe(grid.sectionId);
    expect(validated.data.academic_session_id).toBe(grid.sessionId);
    expect(validated.data.has_hard_conflicts).toBe(true);
    const found = validated.data.conflicts.find(
      (conflict) => conflict.type === "teacher_not_allocated",
    );
    if (!found) throw new Error("expected the unallocated teacher to be reported");
    expect(found.severity).toBe("hard");
    expect(found.slot_ids).toContain(clashing.data.id);

    const refused = await liveApiClient
      .post(`/timetables/${grid.sectionId}:publish`, { academic_session_id: grid.sessionId })
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ApiError);
    const refusal = refused as ApiError;
    expect(refusal.status).toBe(422);
    // The findings ride in `meta`, never in `details`. `details` is a flat
    // `{field, issue}` list and the error handler walks any nested value into it one
    // leaf at a time, which turns `slot_ids` into one entry per id — of which
    // `fieldErrors()` keeps only the first, so a client would highlight one side of a
    // clash and not the other. Both halves are asserted because the flattened shape is
    // the regression this arrangement exists to prevent.
    expect(refusal.details.some((detail) => detail.field?.startsWith("conflicts"))).toBe(false);
    expect(conflictTypes(refusal.meta.conflicts as Conflict[])).toContain("teacher_not_allocated");
    // Nothing was promoted: the refusal is all-or-nothing.
    const stillDraft = await liveApiClient.get<Slot[]>("/timetable-slots", {
      query: { section_id: grid.sectionId, status: "published" },
    });
    expect(stillDraft.data).toEqual([]);

    // Fix it the way the grid does — move the cell onto the subject the teacher is
    // actually allocated to, rather than clearing the teacher.
    const fixed = await liveApiClient.patch<Slot>(`/timetable-slots/${clashing.data.id}`, {
      subject_id: grid.allocatedSubjectId,
    });
    expect(fixed.meta?.conflicts).toEqual([]);

    const revalidated = await liveApiClient.post<{
      conflicts: Conflict[];
      has_hard_conflicts: boolean;
    }>(`/timetables/${grid.sectionId}:validate`, { academic_session_id: grid.sessionId });
    expect(revalidated.data.conflicts).toEqual([]);
    expect(revalidated.data.has_hard_conflicts).toBe(false);

    const published = await liveApiClient.post<{
      published: number;
      superseded: number;
      conflicts: Conflict[];
    }>(`/timetables/${grid.sectionId}:publish`, { academic_session_id: grid.sessionId });
    expect(published.status).toBe(200);
    expect(published.data.published).toBe(2);
    // Nothing to supersede on a first publish — the count is non-zero only on a
    // mid-session revision, which is what the end-dating exists for.
    expect(published.data.superseded).toBe(0);
    expect(published.data.conflicts).toEqual([]);

    const live = await liveApiClient.get<Slot[]>("/timetable-slots", {
      query: { section_id: grid.sectionId, status: "published" },
    });
    expect(live.data).toHaveLength(2);
    for (const row of live.data) {
      expect(row.effective_from).not.toBeNull();
      expect(row.effective_to).toBeNull();
    }

    // Republishing with every draft already promoted is a 422 too — but a plain one:
    // "there is no draft to publish" is a sentence, not a list of cells, so `meta` is
    // absent rather than empty.
    const nothingToPublish = await liveApiClient
      .post(`/timetables/${grid.sectionId}:publish`, { academic_session_id: grid.sessionId })
      .catch((error: unknown) => error);
    expect(nothingToPublish).toBeInstanceOf(ApiError);
    expect((nothingToPublish as ApiError).status).toBe(422);
    expect((nothingToPublish as ApiError).meta.conflicts).toBeUndefined();
  });
});

test.describe("teacher-substitutions (live API)", () => {
  test("cover is proposed on a published slot, then approved or declined", async ({
    liveApiClient,
  }) => {
    const grid = await seedTimetableGrid(liveApiClient);
    const period = grid.periods[0];
    if (!period) throw new Error("expected a seeded schedulable period");

    const [monday, tuesday, substitute] = await Promise.all([
      fillCell(liveApiClient, grid, {
        dayOfWeek: 0,
        periodId: period.id,
        subjectId: grid.allocatedSubjectId,
      }),
      fillCell(liveApiClient, grid, {
        dayOfWeek: 1,
        periodId: period.id,
        subjectId: grid.allocatedSubjectId,
      }),
      findSeededStaff(liveApiClient, E2E_BASELINE_SUBSTITUTE_EMPLOYEE_NUMBER),
    ]);

    // Only a published slot can be covered: covering a draft cell would be covering a
    // class nobody has been told about (§7.2).
    await liveApiClient.post(`/timetables/${grid.sectionId}:publish`, {
      academic_session_id: grid.sessionId,
    });

    // Two dates, one per slot's own weekday. Different weekdays rather than one date
    // twice, because `_assert_substitute_is_free` refuses a substitute already covering
    // another class in that period on that date — session-wide, and rightly so.
    const mondayDate = firstWeekdayOnOrAfter(grid.sessionStartDate, 0);
    const tuesdayDate = firstWeekdayOnOrAfter(grid.sessionStartDate, 1);

    const proposal = await liveApiClient.post<Substitution>("/teacher-substitutions", {
      timetable_slot_id: monday.data.id,
      date: mondayDate,
      absent_staff_id: grid.teacherId,
      substitute_staff_id: substitute.id,
      reason: "Sick leave",
    });
    expect(proposal.status).toBe(201);
    // Never `confirmed` on create, however the client asks: the decision is a separate
    // step held by a different role, so `status` is read-only on the serializer.
    expect(proposal.data.status).toBe("proposed");
    expect(proposal.data.date).toBe(mondayDate);

    const second = await liveApiClient.post<Substitution>("/teacher-substitutions", {
      timetable_slot_id: tuesday.data.id,
      date: tuesdayDate,
      absent_staff_id: grid.teacherId,
      substitute_staff_id: substitute.id,
      reason: "Training day",
    });
    expect(second.status).toBe(201);

    const listed = await liveApiClient.get<Substitution[]>("/teacher-substitutions", {
      query: { substitute_staff_id: substitute.id, status: "proposed", date: mondayDate },
    });
    expect(listed.data.map((row) => row.id)).toContain(proposal.data.id);
    expect(listed.data.map((row) => row.id)).not.toContain(second.data.id);

    const approved = await liveApiClient.post<Substitution>(
      `/teacher-substitutions/${proposal.data.id}:approve`,
    );
    expect(approved.status).toBe(200);
    expect(approved.data.status).toBe("confirmed");

    const declined = await liveApiClient.post<Substitution>(
      `/teacher-substitutions/${second.data.id}:reject`,
    );
    expect(declined.status).toBe(200);
    expect(declined.data.status).toBe("declined");

    // The state machine is one-way. A second decision is a 409 rather than a silent
    // no-op, so an approver acting on a stale list learns that someone got there first.
    const again = await liveApiClient
      .post(`/teacher-substitutions/${proposal.data.id}:reject`)
      .catch((error: unknown) => error);
    expect(again).toBeInstanceOf(ApiError);
    expect((again as ApiError).status).toBe(409);
  });

  test("the seeded proposal is a real row, and 404 to another tenant's admin", async ({
    liveApiClient,
    liveOtherTenantApiClient,
  }) => {
    // `ordering=date`, not the list default: `CursorPagination.ordering` is
    // `-created_at`, so on a long-lived dev database the seeded row — the oldest
    // substitution in the table — would sit off the end of the first page. Its date is
    // a week out while every spec-created one is years out (`farFutureSessionWindow`),
    // so ascending date puts it first for as long as that stays true.
    const proposals = await liveApiClient.get<Substitution[]>("/teacher-substitutions", {
      query: { status: "proposed", ordering: "date", page_size: 100 },
    });
    const seeded = proposals.data.find((row) => row.reason === E2E_BASELINE_SUBSTITUTION_REASON);
    if (!seeded) {
      throw new Error("no seeded substitution proposal — run manage.py seed_e2e_data");
    }
    expect(seeded.status).toBe("proposed");
    expect(seeded.absent_staff_id).not.toBe(seeded.substitute_staff_id);

    // Deliberately *not* decided here: the seed leaves exactly one proposal, and a spec
    // that approves it takes it away from every other run until the next re-seed.
    const probe = await liveOtherTenantApiClient
      .get(`/teacher-substitutions/${seeded.id}`)
      .catch((error: unknown) => error);
    expect(probe).toBeInstanceOf(ApiError);
    expect((probe as ApiError).status).toBe(404);
    expect((probe as ApiError).code).toBe("not_found");
  });
});

test.describe("GET /timetables/my (live API)", () => {
  /**
   * The one endpoint in this module a student or guardian reaches, so it is the one
   * without `DenyRestrictedPrincipals` — and the one whose answer depends entirely on
   * *who is asking*.
   *
   * The worker-shared admin is neither a teacher nor a learner: it has no `Staff` row
   * and no `Student` row, so `Student.filter_owned_by_user` resolves nothing and the
   * week is legitimately empty. What is asserted here is therefore the contract — the
   * audience the server resolved, the session it chose, and that a malformed date is a
   * field error rather than a crash — not a populated grid.
   *
   * Reading back a real week needs an identity with an active enrollment, which
   * `seed_e2e_data` does not create (its two baseline students are enrolled nowhere) —
   * and a narrower identity is one extra login out of `AuthEndpointThrottle`'s 10/min.
   * That is the fixture to add when a spec is written for §5.7's "an unpublished
   * timetable never reaches a student"; it is not something this file can fake.
   */
  test("resolves an audience and a session, and refuses a malformed date", async ({
    liveApiClient,
  }) => {
    const base = await liveApiClient.get<unknown[]>("/timetables/my");
    expect(base.status).toBe(200);
    expect(Array.isArray(base.data)).toBe(true);
    expect(base.meta?.audience).toBe("learner");
    // No `?date=`, so the base grid rather than a dated one — the distinction §7.2
    // rests on, since a substitution overrides one cell for specific dates only.
    expect(base.meta?.date).toBeNull();
    // Falls back to the tenant's current session, which the seed marks `is_current`.
    expect(typeof base.meta?.academic_session_id).toBe("string");

    const scaffold = await seedTimetableScaffold(liveApiClient);
    const explicit = await liveApiClient.get<unknown[]>("/timetables/my", {
      query: { academic_session_id: scaffold.sessionId, date: scaffold.sessionStartDate },
    });
    expect(explicit.meta?.academic_session_id).toBe(scaffold.sessionId);
    expect(explicit.meta?.date).toBe(scaffold.sessionStartDate);

    const malformed = await liveApiClient
      .get("/timetables/my", { query: { date: "not-a-date" } })
      .catch((error: unknown) => error);
    expect(malformed).toBeInstanceOf(ApiError);
    expect((malformed as ApiError).status).toBe(400);
    expect(Object.keys((malformed as ApiError).fieldErrors())).toContain("date");
  });
});
