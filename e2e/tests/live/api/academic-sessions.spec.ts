import { buildLiveAcademicSession, buildLiveTerm } from "@/data/live-factories";
import { expect, test } from "@/fixtures";

/**
 * Live API lane — no browser, no UI. See campuses.spec.ts's header comment for the shared
 * rationale (real HTTP contract only; field validation stays at the Django unit level).
 *
 * The highest-value file in this lane: session lifecycle transitions
 * (`:activate`/`:close`/`:clone`) are the one part of school_organization with real
 * state-machine behavior worth proving end-to-end, including a real database constraint
 * (`sessions_one_current_per_tenant`) that no mocked stub can honestly assert fires.
 *
 * `:activate` only succeeds here because `seed_e2e_data` seeds one active campus and one
 * active class-with-section tenant-wide (the parts of `session_completeness_errors` that
 * are not specific to the session being activated) — this test only has to add the
 * session-specific term.
 */
test.describe("academic sessions (live API)", () => {
  test("activate demotes the incumbent current session, then close and clone", async ({
    liveApiClient,
  }) => {
    const incumbent = await liveApiClient.get<Array<{ id: string; is_current: boolean }>>(
      "/academic-sessions",
      { query: { is_current: true } },
    );
    const incumbentId = incumbent.data[0]?.id;

    const created = await liveApiClient.post("/academic-sessions", buildLiveAcademicSession());
    expect(created.status).toBe(201);
    const session = created.data as {
      id: string;
      status: string;
      is_current: boolean;
      start_date: string;
      end_date: string;
    };
    expect(session.status).toBe("planned");
    expect(session.is_current).toBe(false);

    await liveApiClient.post("/terms", {
      ...buildLiveTerm(session),
      academic_session_id: session.id,
    });

    try {
      const activated = await liveApiClient.post(`/academic-sessions/${session.id}:activate`);
      expect(activated.status).toBe(200);
      expect(activated.meta?.message).toBe("Session activated.");
      const activatedSession = activated.data as { status: string; is_current: boolean };
      expect(activatedSession.status).toBe("active");
      expect(activatedSession.is_current).toBe(true);

      if (incumbentId) {
        const demoted = await liveApiClient.get(`/academic-sessions/${incumbentId}`);
        expect((demoted.data as { is_current: boolean }).is_current).toBe(false);
      }

      const closed = await liveApiClient.post(`/academic-sessions/${session.id}:close`);
      expect(closed.status).toBe(200);
      expect(closed.meta?.message).toBe("Session closed.");
      const closedSession = closed.data as { status: string; is_current: boolean };
      expect(closedSession.status).toBe("closed");
      expect(closedSession.is_current).toBe(false);

      const cloned = await liveApiClient.post(`/academic-sessions/${session.id}:clone`, {
        ...buildLiveAcademicSession(),
      });
      expect(cloned.status).toBe(201);
      const clonedSession = cloned.data as { id: string; status: string };
      expect(clonedSession.id).not.toBe(session.id);
      expect(clonedSession.status).toBe("planned");
    } finally {
      // AcademicSession has no destroy endpoint — restore the tenant's "current session"
      // invariant for any other live spec (and any rerun of this one) that assumes one
      // exists, rather than leaving it demoted after this test's own activation.
      if (incumbentId) {
        await liveApiClient.post(`/academic-sessions/${incumbentId}:activate`).catch(() => {
          // Best-effort restoration; a failure here must not mask the test's own result.
        });
      }
    }
  });
});
